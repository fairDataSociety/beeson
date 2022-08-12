import { JsonMap, JsonValue, Reference } from './types'
import { keccak256, Message } from 'js-sha3'
import { isSwarmCid } from './marshalling/address-serializer'

export const SEGMENT_SIZE = 32

export type FlavoredType<Type, Name> = Type & { __tag__?: Name }

export type PrefixedHexString = FlavoredType<string, 'PrefixedHexString'>

export interface Bytes<Length extends number> extends Uint8Array {
  readonly length: Length
}

/**
 * Nominal type to represent hex strings WITHOUT '0x' prefix.
 * For example for 32 bytes hex representation you have to use 64 length.
 */
export type HexString<Length extends number = number> = FlavoredType<
  string & {
    readonly length: Length
  },
  'HexString'
>

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false

  return a.every((byte, index) => b[index] === byte)
}

/**
 * Returns a new byte array filled with zeroes with the specified length
 *
 * @param length The length of data to be returned
 */
export function makeBytes<Length extends number>(length: Length): Bytes<Length> {
  return new Uint8Array(length) as Bytes<Length>
}

export function keccak256Hash(...messages: Message[]): Bytes<32> {
  const hasher = keccak256.create()

  messages.forEach(bytes => hasher.update(bytes))

  return Uint8Array.from(hasher.digest()) as Bytes<32>
}

/**
 * Converts a hex string to Uint8Array
 *
 * @param hex string input without 0x prefix!
 */
export function hexToBytes<Length extends number, LengthHex extends number = number>(
  hex: HexString<LengthHex>,
): Bytes<Length> {
  assertHexString(hex)

  const bytes = makeBytes(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    const hexByte = hex.substr(i * 2, 2)
    bytes[i] = parseInt(hexByte, 16)
  }

  return bytes as Bytes<Length>
}

/**
 * Converts array of number or Uint8Array to HexString without prefix.
 *
 * @param bytes   The input array
 * @param len     The length of the non prefixed HexString
 */
export function bytesToHex<Length extends number = number>(
  bytes: Uint8Array,
  len?: Length,
): HexString<Length> {
  const hexByte = (n: number) => n.toString(16).padStart(2, '0')
  const hex = Array.from(bytes, hexByte).join('') as HexString<Length>

  if (len && hex.length !== len) {
    throw new TypeError(`Resulting HexString does not have expected length ${len}: ${hex}`)
  }

  return hex
}

export class Bytes<Length extends number = number> extends Uint8Array implements Bytes<Length> {}

/** Overwrites `a` bytearrays elements with elements of `b` starts from `i` */
export function overwriteBytes(a: Uint8Array, b: Uint8Array, i = 0): void {
  if (a.length < b.length + i) {
    throw Error(
      `Cannot copy bytes because the base byte array length is lesser (${a.length}) than the others (${b.length})`,
    )
  }

  for (let index = 0; index < b.length; index++) {
    a[index + i] = b[index]
  }
}

/**
 * Flattens the given array that consist of Uint8Arrays.
 */
export function flattenBytesArray(bytesArray: Uint8Array[]): Uint8Array {
  if (bytesArray.length === 0) return new Uint8Array(0)

  const bytesLength = bytesArray.map(v => v.length).reduce((sum, v) => (sum += v))
  const flattenBytes = new Uint8Array(bytesLength)
  let nextWriteIndex = 0
  for (const b of bytesArray) {
    overwriteBytes(flattenBytes, b, nextWriteIndex)
    nextWriteIndex += b.length
  }

  return flattenBytes
}

export function segmentPaddingFromLeft(bytes: Uint8Array) {
  const paddingBytes = SEGMENT_SIZE - (bytes.length % SEGMENT_SIZE)
  if (paddingBytes !== SEGMENT_SIZE) {
    return new Uint8Array([...new Uint8Array(SEGMENT_SIZE - (bytes.length % SEGMENT_SIZE)), ...bytes])
  }

  return bytes
}

export function segmentPaddingFromRight(bytes: Uint8Array) {
  const paddingBytes = SEGMENT_SIZE - (bytes.length % SEGMENT_SIZE)
  if (paddingBytes !== SEGMENT_SIZE) {
    return new Uint8Array([...bytes, ...new Uint8Array(SEGMENT_SIZE - (bytes.length % SEGMENT_SIZE))])
  }

  return bytes
}

export function stringToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

export function bytesToString(value: Uint8Array): string {
  return new TextDecoder().decode(value)
}

/// used-defined type guards and assert functions

export function isObject(value: unknown): value is JsonMap<unknown> {
  return value !== null && typeof value === 'object'
}

export function assertObject(value: unknown): asserts value is JsonMap<unknown> {
  if (!isObject(value)) throw new AssertJsonValueError(value, 'object')
}

export function isUint8Array(obj: unknown): obj is Uint8Array {
  return obj instanceof Uint8Array
}

export function isBigInt(value: unknown): value is BigInt {
  return typeof value === 'bigint'
}

export function assertBigInt(value: unknown): asserts value is BigInt {
  if (!isBigInt(value)) throw new AssertJsonValueError(value, 'bigint')
}

export function isInteger(value: unknown): value is number {
  return Number.isInteger(value)
}

export function assertInteger(value: unknown): asserts value is number {
  if (!isInteger(value)) throw new AssertJsonValueError(value, 'number (integer)')
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

export function assertNumber(value: unknown): asserts value is number {
  if (!isNumber(value)) throw new AssertJsonValueError(value, 'number')
}

export function assertHexString<Length extends number = number>(
  s: unknown,
  len?: number,
  name = 'value',
): asserts s is HexString<Length> {
  if (!isHexString(s, len)) {
    if (isPrefixedHexString(s)) {
      throw new TypeError(`${name} not valid non prefixed hex string (has 0x prefix): ${s}`)
    }

    // Don't display length error if no length specified in order not to confuse user
    const lengthMsg = len ? ` of length ${len}` : ''
    throw new TypeError(`${name} not valid hex string${lengthMsg}: ${s}`)
  }
}

/**
 * Type guard for PrefixedHexStrings.
 * Does enforce presence of 0x prefix!
 *
 * @param s string input
 */
export function isPrefixedHexString(s: unknown): s is PrefixedHexString {
  return typeof s === 'string' && /^0x[0-9a-f]+$/i.test(s)
}

/**
 * Type guard for HexStrings.
 * Requires no 0x prefix!
 *
 * @param s string input
 * @param len expected length of the HexString
 */
export function isHexString<Length extends number = number>(
  s: unknown,
  len?: number,
): s is HexString<Length> {
  return typeof s === 'string' && /^[0-9a-f]+$/i.test(s) && (!len || s.length === len)
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

export function assertBoolean(value: unknown): asserts value is boolean {
  if (!isBoolean(value)) throw new AssertJsonValueError(value, 'boolean')
}

export function isNull(value: unknown): value is null {
  return value === null
}

export function assertNull(value: unknown): asserts value is null {
  if (!isNull(value)) throw new AssertJsonValueError(value, 'null')
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function assertString(value: unknown): asserts value is string {
  if (!isString(value)) throw new AssertJsonValueError(value, 'string')
}

export function isArray(value: unknown): value is Array<unknown> {
  return Array.isArray(value)
}

export function assertArray(value: unknown): asserts value is Array<unknown> {
  if (!isArray(value)) throw new AssertJsonValueError(value, 'array')
}

export function isJsonValue(value: unknown): value is JsonValue {
  return (
    isBoolean(value) ||
    isNumber(value) ||
    isObject(value) ||
    isString(value) ||
    isArray(value) ||
    isSwarmCid(value)
  )
}

export function assertJsonValue(value: unknown): asserts value is JsonValue {
  if (!isJsonValue(value)) {
    throw new Error(`Given value ${value} is not a value JsonValue for BeeSon`)
  }
}

export class AssertJsonValueError extends Error {
  constructor(value: unknown, expectedType: string) {
    super(`Wrong value for type ${expectedType}. Got value has type: ${typeof value}. Value: ${value}`)
  }
}

export function clearUndefinedObjValues(obj: Record<string | number | symbol, unknown>) {
  Object.keys(obj).forEach(key => obj[key] === undefined && delete obj[key])
}

export function segmentSize(bytesLength: number): number {
  return Math.ceil(bytesLength / SEGMENT_SIZE)
}

export function paddingToSegment(segmentCount: number, data: Uint8Array): Uint8Array {
  const dataSegmentSize = segmentSize(data.length)
  if (segmentCount < dataSegmentSize) {
    throw new Error(`Data has more segments ${segmentCount} than its limit ${segmentCount}`)
  }

  if (segmentCount > dataSegmentSize) {
    const paddingByteSize = (segmentCount - dataSegmentSize) * SEGMENT_SIZE

    return new Uint8Array([...data, ...new Uint8Array(paddingByteSize)])
  }

  return data
}

export function createStorage() {
  const storage = new Map<string, Uint8Array>()

  const storageSaverSync = (reference: Reference, data: Uint8Array) => {
    storage.set(reference.toString(), data)
  }

  const storageLoader = async (reference: Reference): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      const data = storage.get(reference.toString())
      if (!data) {
        reject('404 on Reference')

        return
      }
      resolve(data)
    })
  }

  return {
    storageLoader,
    storageSaverSync,
  }
}
