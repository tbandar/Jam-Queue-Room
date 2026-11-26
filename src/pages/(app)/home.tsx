import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getAuthToken, useAuthProfileReady, useQuery, type RecordData } from 'deepspace'
import { APP_NAME } from '../../constants'

interface RoomItem {
  id: string
  title: string
  hostUserId: string
  hostName: string
  status: 'open' | 'locked' | 'ended'
  nowPlayingTrackId?: string
  createdAt?: number
}

function unwrapRecord<T extends Record<string, unknown>>(rec: unknown): T & { id: string } {
  if (!rec || typeof rec !== 'object') {
    return { id: '' } as T & { id: string }
  }
  const envelope = rec as Record<string, unknown>
  const payload =
    envelope.data && typeof envelope.data === 'object'
      ? (envelope.data as Record<string, unknown>)
      : envelope

  const id =
    typeof envelope.recordId === 'string' && envelope.recordId
      ? envelope.recordId
      : typeof payload.id === 'string' && payload.id
        ? payload.id
        : typeof envelope.id === 'string' && envelope.id
          ? envelope.id
          : ''

  return {
    ...(payload as T),
    id,
  }
}

function toRoomItem(rec: RecordData<RoomItem>): RoomItem {
  const raw = unwrapRecord<Partial<RoomItem>>(rec)
  const envelope = rec as unknown as Record<string, unknown>
  const createdAt =
    typeof raw.createdAt === 'number'
      ? raw.createdAt
      : typeof envelope.createdAt === 'number'
        ? envelope.createdAt
        : 0

  return {
    id: raw.id,
    title: String(raw.title ?? 'Untitled Jam'),
    hostUserId: String(raw.hostUserId ?? ''),
    hostName: String(raw.hostName ?? 'Host'),
    status: raw.status === 'locked' || raw.status === 'ended' ? raw.status : 'open',
    nowPlayingTrackId: raw.nowPlayingTrackId ? String(raw.nowPlayingTrackId) : '',
    createdAt,
  }
}

async function callServerAction<TData = Record<string, unknown>>(
  name: string,
  params: Record<string, unknown>,
): Promise<{ success: boolean; data?: TData; error?: string }> {
  const token = await getAuthToken()
  const res = await fetch(`/api/actions/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
  })
  return (await res.json()) as { success: boolean; data?: TData; error?: string }
}

function extractRoomIdFromInput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const roomMatch = trimmed.match(/\/room\/([a-zA-Z0-9_-]+)/)
  if (roomMatch?.[1]) return roomMatch[1]
  return trimmed
}

export default function HomePage() {
  const navigate = useNavigate()
  const { user } = useAuthProfileReady({ requireUser: true })
  const roomsQuery = useQuery<RoomItem>('rooms', { limit: 50 })

  const defaultName = user?.name?.trim() || user?.email?.split('@')[0] || 'Host'
  const [roomTitle, setRoomTitle] = useState('')
  const [hostName, setHostName] = useState(defaultName)
  const [joinInput, setJoinInput] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const rooms = (roomsQuery.records ?? [])
    .map(toRoomItem)
    .sort((a: RoomItem, b: RoomItem) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

  async function handleCreateRoom(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const cleanTitle = roomTitle.trim()
    if (!cleanTitle) {
      setFormError('Give your setlist room a name first.')
      return
    }

    setCreating(true)
    try {
      const res = await callServerAction<{ roomId?: string; id?: string }>('createRoom', {
        title: cleanTitle,
        hostName: hostName.trim() || defaultName,
      })
      const createdId = res.data?.roomId || res.data?.id
      if (!res.success || !createdId) {
        setFormError(res.error ?? 'Could not create room.')
        return
      }
      navigate(`/room/${createdId}`)
    } catch {
      setFormError('Network error while creating room.')
    } finally {
      setCreating(false)
    }
  }

  function handleJoinRoom(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const targetId = extractRoomIdFromInput(joinInput)
    if (!targetId) {
      setFormError('Enter a room code or paste a /room/... link.')
      return
    }
    navigate(`/room/${targetId}`)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 text-foreground sm:px-6">
      <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {APP_NAME}
          </p>
          <h1 className="text-3xl font-bold tracking-tight">
            Live Setlist &amp; Crowd Jam Board
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Host a live queue, let the crowd pitch songs with duplicate protection, and vote up what plays next.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{defaultName}</span>
        </div>
      </div>

      {formError && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {formError}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <form
          onSubmit={handleCreateRoom}
          className="rounded-xl border border-border bg-card p-5 shadow-sm"
        >
          <h2 className="text-lg font-semibold">Start a Jam Room</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            You become the room host with queue lock, ordering, and playback controls.
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Room / Session Name
              </label>
              <input
                type="text"
                value={roomTitle}
                onChange={(e) => setRoomTitle(e.target.value)}
                placeholder="e.g. Late Night Studio Session"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Your Host Display Name
              </label>
              <input
                type="text"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                placeholder={defaultName}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={creating}
            className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {creating ? 'Creating Room...' : 'Create Live Room'}
          </button>
        </form>

        <form
          onSubmit={handleJoinRoom}
          className="flex flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-sm"
        >
          <div>
            <h2 className="text-lg font-semibold">Join Existing Room</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Paste a room invite link or room ID to pitch tracks and vote in real time.
            </p>

            <div className="mt-4">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Room Code or Link
              </label>
              <input
                type="text"
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value)}
                placeholder="e.g. d3bb04c5 or /room/d3bb04c5"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          <button
            type="submit"
            className="mt-4 w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Join Room
          </button>
        </form>
      </div>

      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Recent &amp; Active Rooms</h2>
          <span className="text-xs text-muted-foreground">{rooms.length} total</span>
        </div>

        {roomsQuery.status === 'loading' ? (
          <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            Loading rooms...
          </div>
        ) : rooms.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            No rooms yet. Create one above to open your first live setlist board.
          </div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {rooms.map((room: RoomItem, idx: number) => (
              <div
                key={room.id || `room-${idx}`}
                className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{room.title}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase ${
                        room.status === 'open'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : room.status === 'locked'
                            ? 'bg-amber-500/15 text-amber-300'
                            : 'bg-zinc-500/20 text-zinc-400'
                      }`}
                    >
                      {room.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Host: {room.hostName} · Code:{' '}
                    <code className="text-foreground">{room.id || 'pending'}</code>
                  </p>
                </div>

                {room.id ? (
                  <Link
                    to={`/room/${room.id}`}
                    className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    Open Board
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}