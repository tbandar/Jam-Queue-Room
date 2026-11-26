import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'

type RoomRecord = {
  id: string
  title: string
  hostUserId: string
  hostName: string
  status: 'open' | 'locked' | 'ended'
  nowPlayingTrackId: string
  createdAt: number
}

type TrackRecord = {
  id: string
  roomId: string
  title: string
  artist: string
  normalizedKey: string
  note: string
  submittedByUserId: string
  submittedByName: string
  status: 'queued' | 'up_next' | 'played'
  sortOrder: number
  voteCount: number
  createdAt: number
}

type VoteRecord = {
  id: string
  roomId: string
  trackId: string
  userId: string
  createdAt: number
}

function normalizeEnvelope<T extends { id?: string }>(raw: unknown): T | null {
  if (!raw || typeof raw !== 'object') return null
  const outer = raw as Record<string, unknown>

  const inner =
    outer.record && typeof outer.record === 'object'
      ? (outer.record as Record<string, unknown>)
      : outer

  const payload =
    inner.data && typeof inner.data === 'object'
      ? (inner.data as Record<string, unknown>)
      : inner

  const id =
    typeof inner.recordId === 'string' && inner.recordId
      ? inner.recordId
      : typeof outer.recordId === 'string' && outer.recordId
        ? outer.recordId
        : typeof payload.id === 'string' && payload.id
          ? payload.id
          : typeof inner.id === 'string' && inner.id
            ? inner.id
            : ''

  if (!id && Object.keys(payload).length === 0) return null
  return {
    ...(payload as T),
    ...(id ? { id } : {}),
  }
}

function unwrapRecord<T extends { id?: string }>(data: unknown): T | null {
  if (!data || typeof data !== 'object') return null
  if ('record' in data && (data as { record: unknown }).record == null) {
    return null
  }
  return normalizeEnvelope<T>(data)
}

function unwrapRecords<T extends { id?: string }>(data: unknown): T[] {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { records?: unknown }).records)
      ? (data as { records: unknown[] }).records
      : []

  return list
    .map((item) => normalizeEnvelope<T>(item))
    .filter((item): item is T => item !== null)
}

function normalizeTrackKey(title: string, artist: string): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/\(feat\.?[^)]*\)/gi, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  return `${clean(title)}::${clean(artist)}`
}

function isNearMatch(aKey: string, bKey: string): boolean {
  if (!aKey || !bKey) return false
  if (aKey === bKey) return true

  const [aTitle = '', aArtist = ''] = aKey.split('::')
  const [bTitle = '', bArtist = ''] = bKey.split('::')
  if (!aTitle || !bTitle) return false

  const aCompactTitle = aTitle.replace(/\s+/g, '')
  const bCompactTitle = bTitle.replace(/\s+/g, '')

  const titleMatch =
    aTitle === bTitle ||
    aCompactTitle === bCompactTitle ||
    (aTitle.length >= 4 && bTitle.includes(aTitle)) ||
    (bTitle.length >= 4 && aTitle.includes(bTitle)) ||
    (aCompactTitle.length >= 4 && bCompactTitle.includes(aCompactTitle)) ||
    (bCompactTitle.length >= 4 && aCompactTitle.includes(bCompactTitle))

  const aCompactArtist = aArtist.replace(/\s+/g, '')
  const bCompactArtist = bArtist.replace(/\s+/g, '')

  const artistMatch =
    !aArtist ||
    !bArtist ||
    aArtist === bArtist ||
    aCompactArtist === bCompactArtist ||
    aArtist.includes(bArtist) ||
    bArtist.includes(aArtist) ||
    (aCompactArtist.length >= 3 && bCompactArtist.includes(aCompactArtist)) ||
    (bCompactArtist.length >= 3 && aCompactArtist.includes(bCompactArtist))

  return titleMatch && artistMatch
}

async function requireHost(
  tools: ActionTools,
  roomId: string,
  userId: string,
): Promise<{ ok: true; room: RoomRecord } | { ok: false; error: string }> {
  const res = await tools.get('rooms', roomId)
  const room = res.success ? unwrapRecord<RoomRecord>(res.data) : null
  if (!room) {
    return { ok: false, error: 'Room not found' }
  }
  if (room.hostUserId !== userId) {
    return { ok: false, error: 'Forbidden: only the room host can perform this action' }
  }
  return { ok: true, room }
}

export const createRoom: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const title = String(params.title ?? '').trim()
  const hostName = String(params.hostName ?? 'Host').trim() || 'Host'
  if (!title) return { success: false, error: 'Room title is required' }

  const roomId = crypto.randomUUID().slice(0, 8)
  const created = await tools.create(
    'rooms',
    {
      title,
      hostUserId: userId,
      hostName,
      status: 'open',
      nowPlayingTrackId: '',
      createdAt: Date.now(),
    },
    roomId,
  )

  if (!created.success) {
    return { success: false, error: created.error ?? 'Failed to create room' }
  }
  return { success: true, data: { roomId, room: unwrapRecord<RoomRecord>(created.data) } }
}

export const setRoomStatus: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const roomId = String(params.roomId ?? '')
  const status = String(params.status ?? '') as RoomRecord['status']
  if (!['open', 'locked', 'ended'].includes(status)) {
    return { success: false, error: 'Invalid room status' }
  }

  const check = await requireHost(tools, roomId, userId)
  if (!check.ok) return { success: false, error: check.error }

  const updated = await tools.update('rooms', roomId, { status })
  return updated.success
    ? { success: true, data: { room: unwrapRecord<RoomRecord>(updated.data) } }
    : { success: false, error: updated.error ?? 'Failed to update room status' }
}

export const submitTrack: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const roomId = String(params.roomId ?? '')
  const title = String(params.title ?? '').trim()
  const artist = String(params.artist ?? '').trim()
  const note = String(params.note ?? '').trim().slice(0, 180)
  const submittedByName = String(params.submittedByName ?? 'Guest').trim() || 'Guest'

  if (!title || !artist) {
    return { success: false, error: 'Song title and artist are required' }
  }

  const roomRes = await tools.get('rooms', roomId)
  const room = roomRes.success ? unwrapRecord<RoomRecord>(roomRes.data) : null
  if (!room) {
    return { success: false, error: 'Room not found' }
  }
  if (room.status === 'locked') {
    return { success: false, error: 'Queue is locked by the host — upvote existing tracks instead!' }
  }
  if (room.status === 'ended') {
    return { success: false, error: 'This jam session has ended' }
  }

  const existingRes = await tools.query('tracks', {
    where: { roomId },
    limit: 250,
  })
  const existingTracks = existingRes.success ? unwrapRecords<TrackRecord>(existingRes.data) : []
  const normalizedKey = normalizeTrackKey(title, artist)

  const duplicate = existingTracks.find(
    (t) => t.status !== 'played' && isNearMatch(normalizedKey, t.normalizedKey),
  )
  if (duplicate) {
    return {
      success: true,
      data: {
        duplicate: true,
        existingTrack: duplicate,
        message: `"${duplicate.title}" by ${duplicate.artist} is already in the queue!`,
      },
    }
  }

  const maxOrder = existingTracks.reduce((max, t) => Math.max(max, t.sortOrder ?? 0), 0)
  const trackId = crypto.randomUUID()

  const created = await tools.create(
    'tracks',
    {
      roomId,
      title,
      artist,
      normalizedKey,
      note,
      submittedByUserId: userId,
      submittedByName,
      status: 'queued',
      sortOrder: maxOrder + 100,
      voteCount: 1,
      createdAt: Date.now(),
    },
    trackId,
  )

  if (!created.success) {
    return { success: false, error: created.error ?? 'Failed to add track' }
  }

  await tools.create(
    'votes',
    {
      roomId,
      trackId,
      userId,
      createdAt: Date.now(),
    },
    `${trackId}:${userId}`,
  )

  return { success: true, data: { trackId, track: unwrapRecord<TrackRecord>(created.data) } }
}

export const toggleVote: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const roomId = String(params.roomId ?? '')
  const trackId = String(params.trackId ?? '')
  if (!roomId || !trackId) return { success: false, error: 'roomId and trackId are required' }

  const trackRes = await tools.get('tracks', trackId)
  const track = trackRes.success ? unwrapRecord<TrackRecord>(trackRes.data) : null
  if (!track || track.roomId !== roomId) {
    return { success: false, error: 'Track not found' }
  }

  const voteId = `${trackId}:${userId}`
  const existingVoteRes = await tools.get('votes', voteId)
  const existingVote = existingVoteRes.success ? unwrapRecord<VoteRecord>(existingVoteRes.data) : null

  if (existingVote) {
    await tools.remove('votes', voteId)
  } else {
    await tools.create(
      'votes',
      {
        roomId,
        trackId,
        userId,
        createdAt: Date.now(),
      },
      voteId,
    )
  }

  const allVotesRes = await tools.query('votes', {
    where: { trackId },
    limit: 500,
  })
  const allVotes = allVotesRes.success ? unwrapRecords<VoteRecord>(allVotesRes.data) : []
  const voteCount = allVotes.length
  await tools.update('tracks', trackId, { voteCount })

  return { success: true, data: { voteCount } }
}

export const hostUpdateTrack: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const roomId = String(params.roomId ?? '')
  const trackId = String(params.trackId ?? '')
  const action = String(params.action ?? '')

  const check = await requireHost(tools, roomId, userId)
  if (!check.ok) return { success: false, error: check.error }

  const trackRes = await tools.get('tracks', trackId)
  const track = trackRes.success ? unwrapRecord<TrackRecord>(trackRes.data) : null
  if (!track || track.roomId !== roomId) {
    return { success: false, error: 'Track not found in this room' }
  }

  if (action === 'delete') {
    await tools.deleteWhere('votes', { trackId }, 500)
    await tools.remove('tracks', trackId)
    if (check.room.nowPlayingTrackId === trackId) {
      await tools.update('rooms', roomId, { nowPlayingTrackId: '' })
    }
    return { success: true, data: { deleted: true } }
  }

  if (action === 'up_next') {
    const currentUpNextRes = await tools.query('tracks', {
      where: { roomId, status: 'up_next' },
      limit: 20,
    })
    const currentUpNext = currentUpNextRes.success
      ? unwrapRecords<TrackRecord>(currentUpNextRes.data)
      : []
    for (const t of currentUpNext) {
      if (t.id !== trackId) {
        await tools.update('tracks', t.id, { status: 'queued' })
      }
    }
    await tools.update('tracks', trackId, { status: 'up_next' })
    await tools.update('rooms', roomId, { nowPlayingTrackId: trackId })
    return { success: true, data: { status: 'up_next' } }
  }

  if (action === 'played') {
    await tools.update('tracks', trackId, { status: 'played' })
    if (check.room.nowPlayingTrackId === trackId) {
      await tools.update('rooms', roomId, { nowPlayingTrackId: '' })
    }
    return { success: true, data: { status: 'played' } }
  }

  if (action === 'requeue') {
    await tools.update('tracks', trackId, { status: 'queued' })
    return { success: true, data: { status: 'queued' } }
  }

  if (action === 'move_up' || action === 'move_down') {
    const roomTracksRes = await tools.query('tracks', {
      where: { roomId },
      limit: 250,
    })
    const allTracks = roomTracksRes.success ? unwrapRecords<TrackRecord>(roomTracksRes.data) : []
    const queued = allTracks
      .filter((t) => t.status === 'queued')
      .sort((a, b) => b.voteCount - a.voteCount || a.sortOrder - b.sortOrder)

    const idx = queued.findIndex((t) => t.id === trackId)
    if (idx === -1) return { success: true, data: { moved: false } }
    const swapIdx = action === 'move_up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= queued.length) return { success: true, data: { moved: false } }

    const current = queued[idx]
    const neighbor = queued[swapIdx]
    const currentOrder = current.sortOrder ?? idx * 100
    const neighborOrder = neighbor.sortOrder ?? swapIdx * 100

    await tools.update('tracks', current.id, {
      sortOrder:
        neighborOrder === currentOrder
          ? neighborOrder + (action === 'move_up' ? -10 : 10)
          : neighborOrder,
    })
    await tools.update('tracks', neighbor.id, {
      sortOrder: currentOrder,
    })
    return { success: true, data: { moved: true } }
  }

  return { success: false, error: 'Unknown host track action' }
}