import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAuthToken, useAuthProfileReady, useQuery, type RecordData } from 'deepspace'

interface RoomItem {
  id: string
  title: string
  hostUserId: string
  hostName: string
  status: 'open' | 'locked' | 'ended'
  nowPlayingTrackId?: string
  createdAt?: number
}

interface TrackItem {
  id: string
  roomId: string
  title: string
  artist: string
  normalizedKey?: string
  note?: string
  submittedByUserId: string
  submittedByName: string
  status: 'queued' | 'up_next' | 'played'
  sortOrder: number
  voteCount: number
  createdAt?: number
}

interface VoteItem {
  id: string
  roomId: string
  trackId: string
  userId: string
  createdAt?: number
}

interface SubmitTrackResponseData {
  duplicate?: boolean
  existingTrack?: TrackItem
  message?: string
  trackId?: string
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
  return {
    id: raw.id,
    title: String(raw.title ?? 'Untitled Jam'),
    hostUserId: String(raw.hostUserId ?? ''),
    hostName: String(raw.hostName ?? 'Host'),
    status: raw.status === 'locked' || raw.status === 'ended' ? raw.status : 'open',
    nowPlayingTrackId: raw.nowPlayingTrackId ? String(raw.nowPlayingTrackId) : '',
    createdAt:
      typeof raw.createdAt === 'number'
        ? raw.createdAt
        : typeof envelope.createdAt === 'number'
          ? envelope.createdAt
          : 0,
  }
}

function toTrackItem(rec: RecordData<TrackItem>): TrackItem {
  const raw = unwrapRecord<Partial<TrackItem>>(rec)
  const envelope = rec as unknown as Record<string, unknown>
  return {
    id: raw.id,
    roomId: String(raw.roomId ?? ''),
    title: String(raw.title ?? 'Untitled Track'),
    artist: String(raw.artist ?? 'Unknown Artist'),
    normalizedKey: raw.normalizedKey ? String(raw.normalizedKey) : '',
    note: raw.note ? String(raw.note) : '',
    submittedByUserId: String(raw.submittedByUserId ?? ''),
    submittedByName: String(raw.submittedByName ?? 'Listener'),
    status: raw.status === 'up_next' || raw.status === 'played' ? raw.status : 'queued',
    sortOrder: typeof raw.sortOrder === 'number' ? raw.sortOrder : 0,
    voteCount: typeof raw.voteCount === 'number' ? raw.voteCount : 0,
    createdAt:
      typeof raw.createdAt === 'number'
        ? raw.createdAt
        : typeof envelope.createdAt === 'number'
          ? envelope.createdAt
          : 0,
  }
}

function toVoteItem(rec: RecordData<VoteItem>): VoteItem {
  const raw = unwrapRecord<Partial<VoteItem>>(rec)
  const envelope = rec as unknown as Record<string, unknown>
  return {
    id: raw.id,
    roomId: String(raw.roomId ?? ''),
    trackId: String(raw.trackId ?? ''),
    userId: String(raw.userId ?? ''),
    createdAt:
      typeof raw.createdAt === 'number'
        ? raw.createdAt
        : typeof envelope.createdAt === 'number'
          ? envelope.createdAt
          : 0,
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

export default function RoomBoardPage() {
  const params = useParams()
  const roomId = params.roomId ?? ''
  const { user } = useAuthProfileReady({ requireUser: true })

  const roomsQuery = useQuery<RoomItem>('rooms', { limit: 100 })
  const tracksQuery = useQuery<TrackItem>('tracks', { limit: 250 })
  const votesQuery = useQuery<VoteItem>('votes', { limit: 500 })

  const currentUserId = user?.id ?? ''
  const defaultDisplayName = user?.name?.trim() || user?.email?.split('@')[0] || 'Listener'

  const allRooms = useMemo(
    () => (roomsQuery.records ?? []).map(toRoomItem),
    [roomsQuery.records],
  )

  const matchedRoom = useMemo(
    () => allRooms.find((r: RoomItem) => r.id === roomId) ?? null,
    [allRooms, roomId],
  )

  const [roomStatusOverride, setRoomStatusOverride] = useState<RoomItem['status'] | null>(null)

  useEffect(() => {
    setRoomStatusOverride(null)
  }, [roomId, matchedRoom?.status])

  const room: RoomItem = {
    id: matchedRoom?.id || roomId,
    title: matchedRoom?.title || `Jam Room (${roomId})`,
    hostUserId: matchedRoom?.hostUserId || currentUserId,
    hostName: matchedRoom?.hostName || defaultDisplayName,
    status: roomStatusOverride ?? matchedRoom?.status ?? 'open',
    nowPlayingTrackId: matchedRoom?.nowPlayingTrackId ?? '',
    createdAt: matchedRoom?.createdAt ?? 0,
  }

  const isHost = Boolean(
    currentUserId && (matchedRoom ? matchedRoom.hostUserId === currentUserId : true),
  )

  const roomTracks = useMemo(
    () =>
      (tracksQuery.records ?? [])
        .map(toTrackItem)
        .filter((t: TrackItem) => !t.roomId || t.roomId === roomId),
    [tracksQuery.records, roomId],
  )

  const votedTrackIds = useMemo(() => {
    const set = new Set<string>()
    for (const v of (votesQuery.records ?? []).map(toVoteItem)) {
      if ((!v.roomId || v.roomId === roomId) && v.userId === currentUserId) {
        set.add(v.trackId)
      }
    }
    return set
  }, [votesQuery.records, roomId, currentUserId])

  const upNextTracks = useMemo(
    () => roomTracks.filter((t: TrackItem) => t.status === 'up_next'),
    [roomTracks],
  )

  const queuedTracks = useMemo(
    () =>
      roomTracks
        .filter((t: TrackItem) => t.status === 'queued')
        .sort(
          (a: TrackItem, b: TrackItem) =>
            (b.voteCount ?? 0) - (a.voteCount ?? 0) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
        ),
    [roomTracks],
  )

  const playedTracks = useMemo(
    () =>
      roomTracks
        .filter((t: TrackItem) => t.status === 'played')
        .sort((a: TrackItem, b: TrackItem) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    [roomTracks],
  )

  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [note, setNote] = useState('')
  const [submitterName, setSubmitterName] = useState(defaultDisplayName)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [duplicateMatch, setDuplicateMatch] = useState<{
    message: string
    existingTrack: TrackItem
  } | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const writesDisabled = busyKey !== null

  async function handleCopyInvite() {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      setFeedback(`Share link: ${url}`)
    }
  }

  async function handleSubmitTrack(e: FormEvent) {
    e.preventDefault()
    setFeedback(null)
    setDuplicateMatch(null)

    if (!title.trim() || !artist.trim()) {
      setFeedback('Please enter both a song title and artist.')
      return
    }

    setSubmitting(true)
    try {
      const res = await callServerAction<SubmitTrackResponseData>('submitTrack', {
        roomId,
        title: title.trim(),
        artist: artist.trim(),
        note: note.trim(),
        submittedByName: submitterName.trim() || defaultDisplayName,
      })

      if (!res.success) {
        setFeedback(res.error ?? 'Could not submit track.')
        return
      }

      if (res.data?.duplicate && res.data.existingTrack) {
        setDuplicateMatch({
          message:
            res.data.message ??
            `"${res.data.existingTrack.title}" is already in the queue.`,
          existingTrack: toTrackItem(res.data.existingTrack as unknown as RecordData<TrackItem>),
        })
        return
      }

      setTitle('')
      setArtist('')
      setNote('')
      setFeedback('Added to the live queue!')
    } catch {
      setFeedback('Network error submitting track.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleToggleVote(trackId: string) {
    setFeedback(null)
    setBusyKey(`vote:${trackId}`)
    try {
      const res = await callServerAction('toggleVote', { roomId, trackId })
      if (!res.success) {
        setFeedback(res.error ?? 'Could not update vote.')
      } else if (duplicateMatch?.existingTrack.id === trackId) {
        setDuplicateMatch(null)
      }
    } finally {
      setBusyKey(null)
    }
  }

  async function handleSetRoomStatus(status: RoomItem['status']) {
    setFeedback(null)
    setBusyKey(`room:${status}`)
    try {
      const res = await callServerAction('setRoomStatus', { roomId, status })
      if (!res.success) {
        setFeedback(res.error ?? 'Only the room host can change room status.')
      } else {
        setRoomStatusOverride(status)
      }
    } finally {
      setBusyKey(null)
    }
  }

  async function handleHostTrackAction(
    trackId: string,
    action: 'up_next' | 'played' | 'requeue' | 'move_up' | 'move_down' | 'delete',
  ) {
    setFeedback(null)
    setBusyKey(`track:${trackId}:${action}`)
    try {
      const res = await callServerAction('hostUpdateTrack', { roomId, trackId, action })
      if (!res.success) {
        setFeedback(res.error ?? 'Host action failed.')
      }
    } finally {
      setBusyKey(null)
    }
  }

  if (!roomId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <h1 className="text-2xl font-bold">Missing room code</h1>
        <Link
          to="/home"
          className="mt-5 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Back to Jam Rooms
        </Link>
      </div>
    )
  }

  const submissionsClosed = room.status !== 'open'

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 text-foreground sm:px-6">
      <div className="mb-6 flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Link to="/home" className="text-xs text-muted-foreground hover:text-foreground">
              ← All Rooms
            </Link>
            <span className="text-xs text-muted-foreground">/</span>
            <span className="text-xs text-muted-foreground">Code: {room.id}</span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ${
                room.status === 'open'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : room.status === 'locked'
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-zinc-500/20 text-zinc-400'
              }`}
            >
              {room.status === 'open'
                ? 'Queue Open'
                : room.status === 'locked'
                  ? 'Queue Locked'
                  : 'Session Ended'}
            </span>
            {isHost && (
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                Host Controls Active
              </span>
            )}
          </div>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight">{room.title}</h1>
          <p className="text-xs text-muted-foreground">
            Hosted by <span className="text-foreground">{room.hostName}</span> · {roomTracks.length}{' '}
            tracks in board
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyInvite}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            {copiedLink ? 'Link Copied!' : 'Copy Invite Link'}
          </button>

          {isHost && (
            <>
              <button
                type="button"
                disabled={writesDisabled}
                onClick={() =>
                  handleSetRoomStatus(room.status === 'locked' ? 'open' : 'locked')
                }
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
              >
                {room.status === 'locked' ? 'Unlock Queue' : 'Lock Queue'}
              </button>
              <button
                type="button"
                disabled={writesDisabled || room.status === 'ended'}
                onClick={() => handleSetRoomStatus('ended')}
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-50"
              >
                End Session
              </button>
            </>
          )}
        </div>
      </div>

      {feedback && (
        <div className="mb-5 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground">
          {feedback}
        </div>
      )}

      {duplicateMatch && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-amber-200">{duplicateMatch.message}</p>
            <p className="text-xs text-amber-200/80">
              Pitched by {duplicateMatch.existingTrack.submittedByName} ·{' '}
              {duplicateMatch.existingTrack.voteCount} votes
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={writesDisabled}
              onClick={() => handleToggleVote(duplicateMatch.existingTrack.id)}
              className="rounded-lg bg-amber-400 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 hover:opacity-90 disabled:opacity-50"
            >
              {votedTrackIds.has(duplicateMatch.existingTrack.id)
                ? 'Remove Vote'
                : 'Upvote Existing Track'}
            </button>
            <button
              type="button"
              onClick={() => setDuplicateMatch(null)}
              className="rounded-lg border border-amber-300/30 px-2.5 py-1.5 text-xs text-amber-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <form
            onSubmit={handleSubmitTrack}
            className="rounded-xl border border-border bg-card p-5"
          >
            <h2 className="text-base font-semibold">Pitch a Track</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {room.status === 'open'
                ? 'Suggest a song for the crowd to vote up. Duplicates get flagged automatically.'
                : room.status === 'locked'
                  ? 'New submissions are paused while the host locks the queue.'
                  : 'This session has ended.'}
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Song Title *
                </label>
                <input
                  type="text"
                  disabled={submissionsClosed || submitting}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Nocturne in E-flat major"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Artist *
                </label>
                <input
                  type="text"
                  disabled={submissionsClosed || submitting}
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="e.g. Chopin"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Your Name
                </label>
                <input
                  type="text"
                  disabled={submissionsClosed || submitting}
                  value={submitterName}
                  onChange={(e) => setSubmitterName(e.target.value)}
                  placeholder={defaultDisplayName}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Vibe / Crowd Note (optional)
                </label>
                <input
                  type="text"
                  disabled={submissionsClosed || submitting}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Great drop for midnight"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submissionsClosed || submitting}
              className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting
                ? 'Checking & Adding...'
                : submissionsClosed
                  ? 'Submissions Closed'
                  : 'Add to Queue'}
            </button>
          </form>
        </div>

        <div className="space-y-6 lg:col-span-8">
          {upNextTracks.length > 0 && (
            <section className="rounded-xl border border-primary/40 bg-primary/5 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
                Up Next / Spotlight
              </div>
              {upNextTracks.map((track: TrackItem) => (
                <div
                  key={track.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="font-semibold">{track.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {track.artist} · Pitched by {track.submittedByName}
                    </div>
                    {track.note && (
                      <p className="mt-1 text-xs italic text-muted-foreground">“{track.note}”</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={writesDisabled}
                      onClick={() => handleToggleVote(track.id)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                        votedTrackIds.has(track.id)
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background hover:bg-muted'
                      }`}
                    >
                      ▲ {track.voteCount}
                    </button>
                    {isHost && (
                      <>
                        <button
                          type="button"
                          disabled={writesDisabled}
                          onClick={() => handleHostTrackAction(track.id, 'played')}
                          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                        >
                          Mark Played
                        </button>
                        <button
                          type="button"
                          disabled={writesDisabled}
                          onClick={() => handleHostTrackAction(track.id, 'requeue')}
                          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                        >
                          Back to Queue
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Live Crowd Queue</h2>
              <span className="text-xs text-muted-foreground">
                {queuedTracks.length} {queuedTracks.length === 1 ? 'track' : 'tracks'}
              </span>
            </div>

            {tracksQuery.status === 'loading' ? (
              <p className="text-sm text-muted-foreground">Syncing live tracks...</p>
            ) : queuedTracks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Queue is empty. Pitch the first song on the left!
              </p>
            ) : (
              <div className="space-y-2.5">
                {queuedTracks.map((track: TrackItem, index: number) => {
                  const hasVoted = votedTrackIds.has(track.id)
                  return (
                    <div
                      key={track.id}
                      className="flex flex-col gap-3 rounded-lg border border-border bg-background/60 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            #{index + 1}
                          </span>
                          <span className="truncate font-medium">{track.title}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            — {track.artist}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Pitched by <span className="text-foreground">{track.submittedByName}</span>
                          {track.note ? ` · “${track.note}”` : ''}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          disabled={writesDisabled}
                          onClick={() => handleToggleVote(track.id)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                            hasVoted
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-card text-foreground hover:bg-muted'
                          }`}
                        >
                          ▲ {track.voteCount}
                        </button>

                        {isHost && (
                          <>
                            <button
                              type="button"
                              disabled={writesDisabled}
                              onClick={() => handleHostTrackAction(track.id, 'up_next')}
                              className="rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                            >
                              Up Next
                            </button>
                            <button
                              type="button"
                              disabled={writesDisabled || index === 0}
                              onClick={() => handleHostTrackAction(track.id, 'move_up')}
                              title="Move up"
                              className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-30"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={writesDisabled || index === queuedTracks.length - 1}
                              onClick={() => handleHostTrackAction(track.id, 'move_down')}
                              title="Move down"
                              className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-30"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              disabled={writesDisabled}
                              onClick={() => handleHostTrackAction(track.id, 'played')}
                              className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                            >
                              Played
                            </button>
                            <button
                              type="button"
                              disabled={writesDisabled}
                              onClick={() => handleHostTrackAction(track.id, 'delete')}
                              className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {playedTracks.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
                Played Setlist ({playedTracks.length})
              </h2>
              <div className="divide-y divide-border">
                {playedTracks.map((track: TrackItem) => (
                  <div
                    key={track.id}
                    className="flex items-center justify-between py-2 text-xs text-muted-foreground"
                  >
                    <div>
                      <span className="font-medium text-foreground/80">{track.title}</span> —{' '}
                      {track.artist}
                    </div>
                    <div className="flex items-center gap-3">
                      <span>▲ {track.voteCount}</span>
                      {isHost && (
                        <button
                          type="button"
                          disabled={writesDisabled}
                          onClick={() => handleHostTrackAction(track.id, 'requeue')}
                          className="underline hover:text-foreground disabled:opacity-50"
                        >
                          Re-queue
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
} 