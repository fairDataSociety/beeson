import { AssertJsonValueError, Bytes, bytesToHex, FlavoredType, hexToBytes } from '../utils'
import { decodeFeedCid, decodeManifestCid, encodeReference, ReferenceType } from '@ethersphere/swarm-cid'

export type SwarmManifestCid = FlavoredType<Parameters<typeof decodeManifestCid>[0], 'SwarmManifestCid'>
export type SwarmFeedCid = FlavoredType<Parameters<typeof decodeFeedCid>[0], 'SwarmFeedCid'>
export type CID = Exclude<Parameters<typeof decodeFeedCid>[0], string>

export function serializeSwarmSoc(value: SwarmFeedCid): Bytes<32> {
  return hexToBytes(decodeFeedCid(value))
}

export function serializeSwarmCac(value: SwarmManifestCid): Bytes<32> {
  return hexToBytes(decodeManifestCid(value))
}

export function deserializeSwarmSoc(value: Uint8Array): SwarmFeedCid {
  return encodeReference(bytesToHex(value), ReferenceType.FEED)
}

export function deserializeSwarmCac(value: Uint8Array): SwarmManifestCid {
  return encodeReference(bytesToHex(value), ReferenceType.MANIFEST)
}

export function isSwarmManifestCid(value: unknown): value is SwarmManifestCid {
  try {
    decodeManifestCid(value as string)

    return true
  } catch (e) {
    return false
  }
}

export function assertSwarmManifestCid(value: unknown): asserts value is SwarmManifestCid {
  if (!isSwarmManifestCid(value)) throw new AssertJsonValueError(value, 'swarm-manifest-cid')
}

export function isSwarmFeedCid(value: unknown): value is SwarmFeedCid {
  try {
    decodeFeedCid(value as string)

    return true
  } catch (e) {
    return false
  }
}

export function assertSwarmFeedCid(value: unknown): asserts value is SwarmFeedCid {
  if (!isSwarmFeedCid(value)) throw new AssertJsonValueError(value, 'swarm-feed-cid')
}

export function isSwarmCid(input: unknown): input is SwarmFeedCid | SwarmManifestCid {
  // FIXME: after https://github.com/ethersphere/swarm-cid-js/issues/7
  return isSwarmFeedCid(input) || isSwarmManifestCid(input)
}
