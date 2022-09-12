import { from } from 'multiformats/hashes/hasher'
import * as digest from 'multiformats/hashes/digest'
import { BeeSon } from '../../beeson'
import { hexToBytes } from '../../utils'
import { KECCAK_256_CODEC } from '@ethersphere/swarm-cid'

export const encode = async (hashBytes: Uint8Array): Promise<Uint8Array> => {
  // Serialize back to Beeson, and hash reference
  const node = await BeeSon.deserialize(hashBytes)
  node.superBeeSon = true
  const ref = node.serialize({ withoutBlobHeader: true })
  return digest.create(0x1b, ref).digest
}

export const hasher = from({
  name: 'keccak-256',
  code: 0x1b,
  encode,
})
