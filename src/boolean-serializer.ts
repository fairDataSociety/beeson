// in the packed version it can be a bitvector of booleans
// until then trololo

import { Bytes } from './utils'

export function serializeBoolean(value: boolean): Bytes<1> {
  return new Bytes([Number(value)])
}

export function deserializeBoolean(value: Bytes<1>): boolean {
  return Boolean(value[0])
}
