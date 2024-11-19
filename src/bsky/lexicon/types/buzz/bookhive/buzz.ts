/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { ValidationResult, BlobRef } from '@atproto/lexicon'
import { lexicons } from '../../../lexicons'
import { isObj, hasProp } from '../../../util'
import { CID } from 'multiformats/cid'
import * as ComAtprotoRepoStrongRef from '../../com/atproto/repo/strongRef'

export interface Record {
  createdAt: string
  /** The book's hive id, used to correlate user's books with the hive */
  hiveId?: string
  book: ComAtprotoRepoStrongRef.Main
  /** Number of stars given to the book (1-10) which will be mapped to 1-5 stars */
  stars?: number
  comment?: ComAtprotoRepoStrongRef.Main
  [k: string]: unknown
}

export function isRecord(v: unknown): v is Record {
  return (
    isObj(v) &&
    hasProp(v, '$type') &&
    (v.$type === 'buzz.bookhive.buzz#main' || v.$type === 'buzz.bookhive.buzz')
  )
}

export function validateRecord(v: unknown): ValidationResult {
  return lexicons.validate('buzz.bookhive.buzz#main', v)
}
