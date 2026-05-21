const DAILY_API_URL = 'https://api.daily.co/v1'

async function dailyFetch(path: string, options?: RequestInit) {
  const apiKey = process.env.DAILY_API_KEY
  if (!apiKey) throw new Error('DAILY_API_KEY is not set')

  const res = await fetch(`${DAILY_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`Daily.co API error: ${res.status} ${error}`)
  }

  return res.json()
}

export async function createRoom(name: string): Promise<{ url: string; name: string }> {
  const data = await dailyFetch('/rooms', {
    method: 'POST',
    body: JSON.stringify({
      name,
      properties: {
        enable_recording: 'cloud',
        enable_transcription: 'deepgram',
        max_participants: 2,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24h expiry
      },
    }),
  })
  return { url: data.url, name: data.name }
}

export async function deleteRoom(name: string): Promise<void> {
  await dailyFetch(`/rooms/${name}`, { method: 'DELETE' })
}

export async function getRecordings(roomName: string) {
  const data = await dailyFetch(`/recordings?room_name=${roomName}`)
  return data.data ?? []
}

export async function getRecordingDownloadLink(recordingId: string): Promise<string> {
  const data = await dailyFetch(`/recordings/${recordingId}/access-link`)
  return data.download_link
}
