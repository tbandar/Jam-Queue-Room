import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  createRoom,
  hostUpdateTrack,
  setRoomStatus,
  submitTrack,
  toggleVote,
} from './jam-actions'

export const actions: Record<string, ActionHandler<Env>> = {
  createRoom,
  setRoomStatus,
  submitTrack,
  toggleVote,
  hostUpdateTrack,
}