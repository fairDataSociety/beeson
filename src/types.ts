import { SwarmFeedCid, SwarmManifestCid } from './address-serializer'

export enum Type {
  // string types
  string = 'S',
  // numeric types
  int8 = 'i',
  uint8 = 'U',
  int16 = 'I',
  int32 = 'l',
  int64 = 'L',
  float32 = 'd',
  float64 = 'D',
  // misc types
  boolean = 'b',
  swarmCac = 'c',
  swarmSoc = 's',
  // container types
  object = 'o',
  array = 'a',
}

export type ContainerTypes = Type.array | Type.object

export type TypeValue<T extends Type> = T extends Type.array
  ? Array<unknown>
  : T extends Type.boolean
  ? boolean
  : T extends Type.float32 | Type.float64 | Type.int8 | Type.uint8 | Type.int16 | Type.int32
  ? number
  : T extends Type.int64
  ? BigInt
  : T extends Type.object
  ? Record<string, unknown>
  : T extends Type.string
  ? string
  : T extends Type.swarmCac
  ? SwarmManifestCid
  : T extends Type.swarmSoc
  ? SwarmFeedCid
  : never

export type JsonValue =
  | boolean
  | number
  | Record<string, unknown>
  | string
  | SwarmManifestCid
  | SwarmFeedCid
  | unknown[]
  | BigInt

export type TypeofJsonValue<T extends JsonValue> = T extends boolean
  ? boolean
  : T extends number
  ? number
  : T extends Record<string, unknown>
  ? Record<string, unknown>
  : T extends string
  ? string
  : T extends SwarmManifestCid
  ? SwarmManifestCid
  : T extends SwarmFeedCid
  ? SwarmFeedCid
  : T extends unknown[]
  ? unknown[]
  : T extends BigInt
  ? BigInt
  : never

export type ValueType<T extends JsonValue> = T extends Array<unknown>
  ? Type.array
  : T extends boolean
  ? Type.boolean
  : T extends number
  ? Type.float32 | Type.float64 | Type.int8 | Type.uint8 | Type.int16 | Type.int32
  : T extends BigInt
  ? Type.int64
  : T extends Record<string, unknown>
  ? Type.object
  : T extends string
  ? Type.string
  : T extends SwarmManifestCid
  ? Type.swarmCac
  : T extends SwarmFeedCid
  ? Type.swarmSoc
  : never

export class NotSupportedTypeError extends Error {
  constructor(expectedType: string) {
    super(`Type ${expectedType} is not a supported BeeSon type`)
  }
}

export function isBeeSonType(value: unknown): value is Type {
  return Object.values(Type).includes(value as Type)
}

export function assertBeeSonType(value: unknown): asserts value is Type {
  if (!isBeeSonType(value)) {
    throw new Error(`Type "${value}" is not a valid BeeSon type`)
  }
}
