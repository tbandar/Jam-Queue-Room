import type { CollectionSchema } from 'deepspace/schema'

export const roomsSchema: CollectionSchema = {
  name: 'rooms',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'hostUserId', storage: 'text', interpretation: 'plain' },
    { name: 'hostName', storage: 'text', interpretation: 'plain' },
    // 'open' | 'locked' | 'ended'
    { name: 'status', storage: 'text', interpretation: 'plain' },
    { name: 'nowPlayingTrackId', storage: 'text', interpretation: 'plain' },
    { name: 'createdAt', storage: 'number', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

export const tracksSchema: CollectionSchema = {
  name: 'tracks',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain' },
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'artist', storage: 'text', interpretation: 'plain' },
    { name: 'normalizedKey', storage: 'text', interpretation: 'plain' },
    { name: 'note', storage: 'text', interpretation: 'plain' },
    { name: 'submittedByUserId', storage: 'text', interpretation: 'plain' },
    { name: 'submittedByName', storage: 'text', interpretation: 'plain' },
    // 'queued' | 'up_next' | 'played'
    { name: 'status', storage: 'text', interpretation: 'plain' },
    { name: 'sortOrder', storage: 'number', interpretation: 'plain' },
    { name: 'voteCount', storage: 'number', interpretation: 'plain' },
    { name: 'createdAt', storage: 'number', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

export const votesSchema: CollectionSchema = {
  name: 'votes',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain' },
    { name: 'trackId', storage: 'text', interpretation: 'plain' },
    { name: 'userId', storage: 'text', interpretation: 'plain' },
    { name: 'createdAt', storage: 'number', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
} 