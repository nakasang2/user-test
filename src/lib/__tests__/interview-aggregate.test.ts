/**
 * 集計ロジックの単体テスト。
 *
 * 依存を増やさず、Node の型ストリップだけで動かす:
 *   npm test
 *
 * ここを固めているのは、この集計が「1件だけ入れたときは正しく見える」のに
 * 2件目・並べ替え・旧データ・除外・ヒントが絡むと壊れる、という事故を
 * 繰り返してきたため（docs/LESSONS.md の「データ設計」を参照）。
 */
import {
  aggregateTasks, aggregateScores, overallSuccess, avgSessionDuration,
  headlineScore, hardestTask, calcNps, scoreDistribution,
} from '../interview-aggregate.ts'

let pass = 0
let fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log(`  OK   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}
       got  ${g}
       want ${w}`) }
}

console.log('\n=== 集計の基本（並べ替え耐性・境界値） ===')
{

// 同じタスクだが、調査を編集して order が振り直されたケース
const reordered = [
  { id:'s1', participantName:'A', taskResults:[
    { taskId:'T1', order:1, text:'検索する', outcome:'completed', durationSec:60 },
    { taskId:'T2', order:2, text:'決済する', outcome:'gave_up',  durationSec:120 } ] },
  { id:'s2', participantName:'B', taskResults:[
    { taskId:'T2', order:1, text:'決済する', outcome:'gave_up',  durationSec:100 },
    { taskId:'T1', order:2, text:'検索する', outcome:'completed', durationSec:40 } ] },
]
const t = aggregateTasks(reordered)
eq('order が入れ替わっても taskId で正しく2タスクに集約', t.length, 2)
eq('T1 は 2/2 成功', [t.find(x=>x.key==='T1')!.completed, t.find(x=>x.key==='T1')!.total], [2,2])
eq('T2 は 0/2 成功', [t.find(x=>x.key==='T2')!.completed, t.find(x=>x.key==='T2')!.total], [0,2])
eq('表示順は最小 order を採用（T1が先）', t[0].key, 'T1')
eq('全体成功率 50%', overallSuccess(t), { completed:2, completedUnaided:2, hintUsed:0, assistedStart:0, notAttempted:0, total:4, rate:50, unaidedRate:50 })
eq('最も苦戦は T2 の 0%', [hardestTask(t)!.key, hardestTask(t)!.rate], ['T2', 0])
eq('平均所要時間は人単位の合計の平均 (180+140)/2', avgSessionDuration(reordered), {mean:160,n:2})

// taskId が無い旧データは文言でまとまる
const noId = [
  { id:'s1', participantName:'A', taskResults:[{ order:1, text:'検索する', outcome:'completed' }] },
  { id:'s2', participantName:'B', taskResults:[{ order:1, text:'検索する', outcome:'gave_up' }] },
]
eq('taskId 無しは文言で1タスクに集約', aggregateTasks(noId).length, 1)
eq('  その成功率は 50%', overallSuccess(aggregateTasks(noId))!.rate, 50)

// 空・境界
eq('結果ゼロは null（0% と区別）', overallSuccess([]), null)
eq('所要時間が無ければ null', avgSessionDuration([{ id:'s', participantName:'A', taskResults:[{ order:1, text:'x', outcome:'completed' }] }]), null)
eq('全問100%なら「最も苦戦」は出さない', hardestTask(aggregateTasks([{ id:'s', participantName:'A', taskResults:[{ taskId:'T1', order:1, text:'x', outcome:'completed' }] }])), null)
eq('タスクが無ければ null', hardestTask([]), null)

// NPS（推奨9-10 / 中立7-8 / 批判0-6）
eq('NPS 全員推奨 = +100', calcNps([9,10,10]), 100)
eq('NPS 全員批判 = -100', calcNps([0,3,6]), -100)
eq('NPS 混在 (2推奨-1批判)/4', calcNps([9,10,7,3]), 25)
eq('NPS 中立のみ = 0', calcNps([7,8]), 0)

// 見出しスコアは NPS 優先
const scored = [{ id:'s1', participantName:'A', answers:[
  { questionId:'Q1', order:1, text:'満足度', type:'rating', valueNum:4 },
  { questionId:'Q2', order:2, text:'推奨度', type:'nps',    valueNum:9 } ]}]
eq('rating より NPS を見出しに採用', headlineScore(aggregateScores(scored))!.kind, 'nps')
eq('NPS が無ければ rating', headlineScore(aggregateScores([{ id:'s',participantName:'A',answers:[{ questionId:'Q1',order:1,text:'満足度',type:'rating',valueNum:4 }] }]))!.kind, 'rating')
eq('スコア質問が無ければ null', headlineScore(aggregateScores([{ id:'s',participantName:'A',answers:[{ questionId:'Q1',order:1,text:'感想',type:'open',valueText:'よかった' }] }])), null)
eq('自由回答はスコア集計に混ざらない', aggregateScores([{ id:'s',participantName:'A',answers:[{ questionId:'Q1',order:1,text:'感想',type:'open',valueText:'9点' }] }]).length, 0)
}

console.log('\n=== 最も苦戦したタスクの選び方 ===')
{
const T=(id:string|null,o:number,t:string,oc:string,d?:number)=>({taskId:id,order:o,text:t,outcome:oc,durationSec:d})
const S=(id:string,trs:ReturnType<typeof T>[])=>({id,participantName:id,status:'done',taskResults:trs})

console.log('■ 最小サンプル数のガード（残した修正）')
const many=Array.from({length:9},(_,i)=>S('x'+i,[T('TB',1,'B',i<2?'completed':'gave_up')]))
eq('n=1 の断片ではなく本当の問題を選ぶ', hardestTask(aggregateTasks([...many,S('y',[T('TB',1,'B','completed'),T('TE',2,'E','gave_up')])]))!.key,'TB')
const mid=Array.from({length:10},(_,i)=>S('s'+i,i>=6?[T('A',1,'A','completed'),T('B',2,'B','gave_up')]:[T('A',1,'A','completed')]))
eq('途中追加(10人中4人)でも警告を出す', hardestTask(aggregateTasks(mid))!.key,'B')
eq('1人だけの調査でも警告を出す', hardestTask(aggregateTasks([S('a',[T('A',1,'A','gave_up')])]))!.key,'A')

console.log('■ 丸め判定（残した修正）')
const near=[S('z',Array.from({length:200},(_,i)=>T('A',1,'A',i===0?'gave_up':'completed')))]
eq('199/200 でも警告を出す', hardestTask(aggregateTasks(near))!.completed,199)
eq('全問成功なら出さない', hardestTask(aggregateTasks([S('a',[T('A',1,'A','completed')])])),null)

console.log('■ 所要時間は n を返す（残した修正）／削除済みも含む安全側に戻っている')
eq('n を返す', avgSessionDuration([S('a',[T('A',1,'A','completed',100)]),S('b',[T('A',1,'A','completed',200)])]),{mean:150,n:2})
eq('文言を編集した旧データも落とさない（回帰R1の防止）',
  avgSessionDuration([S('a',[T(null,1,'古い文言','gave_up',300)]),S('b',[T('T1',1,'新しい文言','completed',60)])]),{mean:180,n:2})
}

console.log('\n=== 集計対象外（削除済み・手動除外） ===')
{
const T=(taskId:string|null,order:number,text:string,outcome:string,d?:number,excludedAt?:string|null)=>
  ({taskId,order,text,outcome,durationSec:d,excludedAt:excludedAt??null})
type AnswerRow = { questionId: string | null; order: number; text: string; type: string; valueNum?: number; valueText?: string; excludedAt?: string | null }
const S=(id:string,trs:ReturnType<typeof T>[],ans:AnswerRow[]=[])=>({id,participantName:id,status:'done',taskResults:trs,answers:ans})
const EX='2026-07-29T00:00:00.000Z'

console.log('■ 削除済み（印あり）は集計に入らない')
const s=[1,2,3].map(i=>S('s'+i,[
  T('T1',1,'現存タスク','completed',60),
  T(null,2,'削除したタスク','gave_up',900,EX)]))
eq('現存のみ 3/3', overallSuccess(aggregateTasks(s)), {completed:3,completedUnaided:3,hintUsed:0,assistedStart:0,notAttempted:0,total:3,rate:100,unaidedRate:100})
eq('最も苦戦は出ない（全問成功）', hardestTask(aggregateTasks(s)), null)
eq('所要時間も除外分を含まない', avgSessionDuration(s), {mean:60,n:3})
eq('除外分は別枠で取れる', aggregateTasks(s,{excluded:true}).map(r=>[r.text,r.completed,r.total]), [['削除したタスク',0,3]])
eq('通常の集計に除外分は現れない', aggregateTasks(s).length, 1)

console.log('■ 同じ文言で「除外あり」と「除外なし」が混在しても1行に混ざらない')
const mixed=[S('a',[T(null,1,'同じ文言','completed',10,EX)]), S('b',[T(null,1,'同じ文言','gave_up',10,null)])]
eq('通常側は 0/1', overallSuccess(aggregateTasks(mixed)), {completed:0,completedUnaided:0,hintUsed:0,assistedStart:0,notAttempted:0,total:1,rate:0,unaidedRate:0})
eq('除外側は 1/1', aggregateTasks(mixed,{excluded:true})[0].completed, 1)
eq('合算されていない（各1行）', [aggregateTasks(mixed).length, aggregateTasks(mixed,{excluded:true}).length], [1,1])

console.log('■ スコアも同じ')
const sc=[S('a',[],[
  {questionId:'Q1',order:1,text:'推奨度',type:'nps',valueNum:10,excludedAt:null},
  {questionId:null,order:2,text:'消した質問',type:'nps',valueNum:0,excludedAt:EX}])]
const head = headlineScore(aggregateScores(sc))
eq('見出しは現役の NPS のみ', head?.kind === 'nps' ? head.value : null, 100)
eq('除外分は別枠', aggregateScores(sc,{excluded:true}).map(r=>r.text), ['消した質問'])

console.log('■ excludedAt が無い旧データ（undefined）は集計対象')
const legacy=[{id:'x',participantName:'x',taskResults:[{taskId:'T1',order:1,text:'A',outcome:'completed',durationSec:30}]}]
eq('undefined は除外扱いしない', overallSuccess(aggregateTasks(legacy)), {completed:1,completedUnaided:1,hintUsed:0,assistedStart:0,notAttempted:0,total:1,rate:100,unaidedRate:100})
eq('  所要時間も入る', avgSessionDuration(legacy), {mean:30,n:1})

console.log('■ 全部が除外なら通常側は空')
const allEx=[S('z',[T(null,1,'消えた','completed',10,EX)])]
eq('通常側は0行', aggregateTasks(allEx).length, 0)
eq('成功率は null（0% と区別）', overallSuccess(aggregateTasks(allEx)), null)
eq('所要時間も null', avgSessionDuration(allEx), null)
}

console.log('\n=== ヒント（条件付き成功） ===')
{
const T=(o:string,usedHint?:boolean)=>({taskId:'T1',order:1,text:'A',outcome:o,durationSec:10,usedHint})
const S=(id:string,trs:ReturnType<typeof T>[])=>({id,participantName:id,status:'done',taskResults:trs})

console.log('■ ヒントあり達成は「達成」に数えるが、自力とは分ける')
const mixed=[S('a',[T('completed',false)]),S('b',[T('completed',true)]),S('c',[T('gave_up',true)])]
const r=aggregateTasks(mixed)[0]
eq('達成は2件（ヒント有無を問わず）', r.completed, 2)
eq('自力達成は1件', r.completedUnaided, 1)
eq('全体: 成功率67%・自力33%', overallSuccess(aggregateTasks(mixed)),
   {completed:2, completedUnaided:1, hintUsed:2, assistedStart:0, notAttempted:0, total:3, rate:67, unaidedRate:33})

console.log('■ ヒント欄が無かった時代のデータ（usedHint 未定義）は自力扱い')
const legacy=[{id:'x',participantName:'x',taskResults:[{taskId:'T1',order:1,text:'A',outcome:'completed',durationSec:5}]}]
eq('undefined は自力', overallSuccess(aggregateTasks(legacy)),
   {completed:1, completedUnaided:1, hintUsed:0, assistedStart:0, notAttempted:0, total:1, rate:100, unaidedRate:100})

console.log('■ 全員ヒントあり')
const allHint=[S('a',[T('completed',true)]),S('b',[T('completed',true)])]
eq('成功率100%・自力0%', overallSuccess(aggregateTasks(allHint)),
   {completed:2, completedUnaided:0, hintUsed:2, assistedStart:0, notAttempted:0, total:2, rate:100, unaidedRate:0})
eq('全員達成なので「最も苦戦」は出ない', hardestTask(aggregateTasks(allHint)), null)

console.log('■ 除外との組み合わせ')
const withEx=[S('a',[T('completed',true)]),
  {id:'b',participantName:'b',taskResults:[{taskId:null,order:1,text:'消した',outcome:'gave_up',usedHint:true,excludedAt:'2026-07-29T00:00:00.000Z'}]}]
eq('除外行は自力/ヒントどちらにも数えない', overallSuccess(aggregateTasks(withEx)),
   {completed:1, completedUnaided:0, hintUsed:1, assistedStart:0, notAttempted:0, total:1, rate:100, unaidedRate:0})
eq('除外側にも completedUnaided が入る', aggregateTasks(withEx,{excluded:true})[0].completedUnaided, 0)

console.log('■ 指摘6: 全員ヒントを見て全員断念でも、ヒント提示の事実が残る')
const allFail=[S('a',[T('gave_up',true)]),S('b',[T('gave_up',true)]),S('c',[T('gave_up',true)])]
const rf=aggregateTasks(allFail)[0]
eq('達成0・自力0だが hintUsed=3', [rf.completed, rf.completedUnaided, rf.hintUsed], [0,0,3])
eq('全体でも hintUsed が残る', overallSuccess(aggregateTasks(allFail))!.hintUsed, 3)

console.log('■ 結果ゼロ')
eq('null のまま', overallSuccess([]), null)
}

console.log('\n=== 未実施（前提タスクを満たせず着手できなかった） ===')
{
const T=(taskId:string,order:number,text:string,outcome:string,extra:{durationSec?:number;assistedStart?:boolean}={})=>
  ({taskId,order,text,outcome,...extra})
const S=(id:string,trs:ReturnType<typeof T>[])=>({id,participantName:id,status:'done',taskResults:trs})

console.log('■ 未実施は成功率の分母に入らない')
// A: 1を達成して2も達成 / B: 1を断念し、立て直せず2は未実施
const s=[
  S('a',[T('T1',1,'お気に入り追加','completed',{durationSec:30}),T('T2',2,'お気に入りから購入','completed',{durationSec:40})]),
  S('b',[T('T1',1,'お気に入り追加','gave_up',{durationSec:120}),T('T2',2,'お気に入りから購入','not_attempted')]),
]
const rows=aggregateTasks(s)
const t2=rows.find(r=>r.key==='T2')!
eq('T2 の試行は1回だけ（未実施を数えない）', [t2.completed,t2.total,t2.notAttempted], [1,1,1])
eq('T2 の成功率は 100%（0/2 の 50% にしない）', Math.round((t2.completed/t2.total)*100), 100)
eq('全体は 2/3（未実施を除いた分母）', overallSuccess(rows),
   {completed:2, completedUnaided:2, hintUsed:0, assistedStart:0, notAttempted:1, total:3, rate:67, unaidedRate:67})
eq('未実施は「最も苦戦」の判定にも効かない', hardestTask(rows)!.key, 'T1')
// A: 30+40=70 / B: 120（未実施の行は所要時間を持たない）→ (70+120)/2
eq('未実施は所要時間を持たない', avgSessionDuration(s), {mean:95,n:2})

console.log('■ 全員が未実施のタスクは試行 0（0% と区別できる）')
const allSkip=[S('a',[T('T2',1,'X','not_attempted')]),S('b',[T('T2',1,'X','not_attempted')])]
const rs=aggregateTasks(allSkip)[0]
eq('total 0 で notAttempted 2', [rs.total, rs.notAttempted, rs.completed], [0,2,0])
eq('全体成功率は null（試行が無い）', overallSuccess(aggregateTasks(allSkip)), null)
eq('「最も苦戦」も出さない（0% として選ばない）', hardestTask(aggregateTasks(allSkip)), null)

console.log('■ 前提を代行して開始した分は別カウント（自力成功の定義は変えない）')
const assisted=[
  S('a',[T('T2',1,'X','completed')]),
  S('b',[T('T2',1,'X','completed',{assistedStart:true})]),
]
const ra=aggregateTasks(assisted)[0]
eq('達成2・自力2（ヒントは見ていない）', [ra.completed, ra.completedUnaided], [2,2])
eq('前提を代行は1件として別に残る', ra.assistedStart, 1)
eq('全体にも出る', overallSuccess(aggregateTasks(assisted))!.assistedStart, 1)

console.log('■ 除外（削除済み）との組み合わせ')
const withEx=[
  S('a',[T('T2',1,'X','completed')]),
  {id:'b',participantName:'b',taskResults:[
    {taskId:null,order:1,text:'消した',outcome:'not_attempted',excludedAt:'2026-07-29T00:00:00.000Z'}]},
]
eq('除外された未実施は通常側に出ない', overallSuccess(aggregateTasks(withEx)),
   {completed:1, completedUnaided:1, hintUsed:0, assistedStart:0, notAttempted:0, total:1, rate:100, unaidedRate:100})
eq('除外側で未実施として数えられる', aggregateTasks(withEx,{excluded:true})[0].notAttempted, 1)
}

console.log('\n=== 深掘りの深さ（lib/follow-up.ts） ===')
{
  const {
    normalizeFollowUpDepth, effectiveFollowUpDepth,
    FOLLOW_UP_DEPTH_MIN, FOLLOW_UP_DEPTH_MAX, FOLLOW_UP_DEPTH_DEFAULT,
  } = await import('../follow-up.ts')

  eq('既定は2（従来のハードコード値と同じ）', FOLLOW_UP_DEPTH_DEFAULT, 2)
  eq('範囲は1〜5', [FOLLOW_UP_DEPTH_MIN, FOLLOW_UP_DEPTH_MAX], [1, 5])

  eq('正常値はそのまま', [1, 2, 5].map(normalizeFollowUpDepth), [1, 2, 5])
  eq('下限より小さい値は1に丸める', [0, -3].map(normalizeFollowUpDepth), [1, 1])
  eq('上限より大きい値は5に丸める', [6, 999].map(normalizeFollowUpDepth), [5, 5])
  eq('小数は四捨五入', [2.4, 2.6].map(normalizeFollowUpDepth), [2, 3])
  eq('数値でない値は既定に寄せる', ['abc', undefined, null, NaN, ''].map(normalizeFollowUpDepth), [2, 2, 2, 2, 2])
  eq('数字文字列は受け付ける', normalizeFollowUpDepth('3'), 3)

  eq('OFF なら0（AI を呼ばない）', effectiveFollowUpDepth({ followUpEnabled: false, followUpDepth: 4 }), 0)
  eq('ON かつ深さ指定ありならその値', effectiveFollowUpDepth({ followUpEnabled: true, followUpDepth: 4 }), 4)
  eq('深さ未指定なら既定', effectiveFollowUpDepth({ followUpEnabled: true }), 2)
  eq('ON/OFF 未指定（旧データ）は深掘りする', effectiveFollowUpDepth({}), 2)
  eq('OFF でも深さの値は判定に影響しない', effectiveFollowUpDepth({ followUpEnabled: false }), 0)
  eq('壊れた深さでも無限にはならない', effectiveFollowUpDepth({ followUpEnabled: true, followUpDepth: 9999 }), 5)
}


console.log('\n=== 会話履歴の切り詰め（末尾＝直近を残す） ===')
{
  const { clampText, clampTextTail } = await import('../llm-safety.ts')

  const conv = ['AI: 質問1', '参加者: 古い話', 'AI: 質問2', '参加者: いま話していること'].join('\n')
  eq('上限内ならそのまま', clampTextTail(conv, 1000), conv)

  // 上限を小さくして、どちらの端が残るかを見る
  const head = clampText(conv, 20)
  const tail = clampTextTail(conv, 20)
  eq('従来の clampText は冒頭を残す（＝直近が消える）',
    [head.includes('質問1'), head.includes('いま話していること')], [true, false])
  eq('clampTextTail は直近を残す',
    [tail.includes('いま話していること'), tail.includes('質問1')], [true, false])
  eq('省略した旨を明示する', tail.startsWith('…[この前のやり取りは省略]'), true)

  // 行の途中で切らない（誰の発言か分からなくなるのを防ぐ）
  const lines = clampTextTail(conv, 20).split('\n').slice(1)
  eq('残った行は話者から始まる', lines.every((l) => l === '' || /^(AI|参加者): /.test(l)), true)

  eq('文字列以外は空文字', [clampTextTail(null, 10), clampTextTail(undefined, 10)], ['', ''])
  eq('改行が無い長文でも落ちない', clampTextTail('あ'.repeat(100), 10).length > 0, true)
}

console.log('\n=== 深掘りを「しない」の伝わり方（API ガードと同じ判定） ===')
{
  // /api/interviewer は maxFollowUps が 0 以下なら AI を呼ばずに次へ進める。
  // 厳密等価（=== 0）だと "0"・-1・false がすり抜けて「1回だけ深掘り」になっていた。
  const skip = (v: unknown) => v !== null && v !== undefined && Number(v) <= 0

  eq('0 は深掘りしない', skip(0), true)
  eq('文字列の "0" も深掘りしない', skip('0'), true)
  eq('負数も深掘りしない', skip(-1), true)
  eq('false（Number(false)=0）も深掘りしない', skip(false), true)
  eq('未指定は既定に任せる（ここでは弾かない）', [skip(null), skip(undefined)], [false, false])
  eq('正の値は通常どおり', [skip(1), skip(2), skip('3')], [false, false, false])
}

console.log('\n=== 回答分布（選択肢別の件数） ===')
{
  eq('件数を値の昇順で返す', scoreDistribution([3, 1, 3, 2, 1, 3]), [
    { value: 1, count: 2 }, { value: 2, count: 1 }, { value: 3, count: 3 },
  ])
  eq('空なら空配列', scoreDistribution([]), [])
  eq('全員同じ値でも1件にまとまる', scoreDistribution([5, 5, 5]), [{ value: 5, count: 3 }])
  eq('NPS の0〜10も値ごとに分かれる', scoreDistribution([0, 10, 10, 7]), [
    { value: 0, count: 1 }, { value: 7, count: 1 }, { value: 10, count: 2 },
  ])
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
