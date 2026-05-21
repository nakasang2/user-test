import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { writeFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'

const RECORDING_DIR = '/tmp/recordings'

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params

  const session = await prisma.session.findUnique({ where: { id } })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const formData = await req.formData()
  const file = formData.get('recording') as File | null
  if (!file) return NextResponse.json({ error: 'No recording' }, { status: 400 })

  await mkdir(RECORDING_DIR, { recursive: true })
  const filePath = join(RECORDING_DIR, `${id}.webm`)
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(filePath, buffer)

  await prisma.session.update({
    where: { id },
    data: { recordingUrl: `/api/sessions/${id}/recording` },
  })

  return NextResponse.json({ ok: true, url: `/api/sessions/${id}/recording` })
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params

  const filePath = join(RECORDING_DIR, `${id}.webm`)
  try {
    const buffer = await readFile(filePath)
    return new Response(buffer, {
      headers: {
        'Content-Type': 'audio/webm',
        'Content-Disposition': `attachment; filename="interview-${id.slice(0, 8)}.webm"`,
        'Content-Length': String(buffer.byteLength),
      },
    })
  } catch {
    return NextResponse.json({ error: 'Recording not found' }, { status: 404 })
  }
}
