export type Role = 'owner' | 'admin' | 'editor' | 'viewer'

const ROLE_LEVEL: Record<Role, number> = {
  owner:  4,
  admin:  3,
  editor: 2,
  viewer: 1,
}

/** userRole が requiredRole 以上かチェック */
export function hasPermission(userRole: string, requiredRole: Role): boolean {
  return (ROLE_LEVEL[userRole as Role] ?? 0) >= ROLE_LEVEL[requiredRole]
}

/** インタビュー作成・編集可能か (editor 以上) */
export function canEdit(role: string): boolean {
  return hasPermission(role, 'editor')
}

/** メンバー招待・管理可能か (admin 以上) */
export function canManageMembers(role: string): boolean {
  return hasPermission(role, 'admin')
}

/** 組織設定変更可能か (owner のみ) */
export function canManageOrg(role: string): boolean {
  return hasPermission(role, 'owner')
}

export const ROLE_LABELS: Record<Role, string> = {
  owner:  'オーナー',
  admin:  '管理者',
  editor: '編集者',
  viewer: '閲覧者',
}

export const ASSIGNABLE_ROLES: Role[] = ['admin', 'editor', 'viewer']
