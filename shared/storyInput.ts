// 故事需求的輸入驗證，前端送出前與 Worker 收到請求時使用同一份規則（PLAN 3.7）。

export interface StoryInput {
  character: string
  situation: string
  apiKey: string
}

export type StoryInputField = keyof StoryInput

export type StoryInputError = 'required' | 'too_long' | 'has_whitespace'

export type StoryInputErrors = Partial<Record<StoryInputField, StoryInputError>>

export type StoryInputResult =
  | { ok: true; value: StoryInput }
  | { ok: false; errors: StoryInputErrors }

export const CHARACTER_MAX = 30
export const SITUATION_MAX = 100
export const API_KEY_MAX = 200

/** 以 Unicode code point 計算長度（PLAN 3.7）：中文字、英文字母各算 1，組合 emoji 可能算成多個。 */
function codePointLength(value: string): number {
  return [...value].length
}

function checkText(value: string, max: number): StoryInputError | null {
  const length = codePointLength(value)
  if (length === 0) return 'required'
  return length > max ? 'too_long' : null
}

/**
 * 角色與情境去除頭尾空白後檢查必填與上限；key 不修剪，含任何空白就不合格。
 * key 不修剪是刻意的：貼上時夾帶的換行或空白若被悄悄去掉，使用者不知道自己貼的內容有誤，
 * 而指出欄位讓使用者自己修正，送出的就一定是畫面上的那把 key。
 * 任一欄位不合格時不得送出生成請求（A2）。
 */
export function validateStoryInput(input: StoryInput): StoryInputResult {
  const character = input.character.trim()
  const situation = input.situation.trim()
  const { apiKey } = input
  const errors: StoryInputErrors = {}

  const characterError = checkText(character, CHARACTER_MAX)
  if (characterError) errors.character = characterError
  const situationError = checkText(situation, SITUATION_MAX)
  if (situationError) errors.situation = situationError

  if (apiKey === '') errors.apiKey = 'required'
  else if (/\s/.test(apiKey)) errors.apiKey = 'has_whitespace'
  else if (codePointLength(apiKey) > API_KEY_MAX) errors.apiKey = 'too_long'

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { character, situation, apiKey } }
}
