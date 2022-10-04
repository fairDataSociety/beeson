import { from } from 'multiformats/hashes/hasher'
import * as digest from 'multiformats/hashes/digest'
import { BeeSon } from '../../beeson'

export const encode = async (data: Uint8Array): Promise<Uint8Array> => {
  // Serialize back to Beeson, and hash reference
  const node = await BeeSon.deserialize(data)
  const ref = node.swarmHash()

  return digest.create(0x1b, ref).digest
}

export const hasher = from({
  name: 'keccak-256',
  code: 0x1b,
  encode,
})
