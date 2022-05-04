// data derializations happen in bigEndian manner

import { Type } from './types'
import { assertNumber, Bytes } from './utils'

class NumberDeserialisationError extends Error {
  constructor(type: 'float' | 'integer', expectedLength: number, receivedLength: number) {
    super(
      `Given uint array for ${type} deserialisation has different length than ${expectedLength}. Got: ${receivedLength}`,
    )
  }
}

type NumberValue<T extends Type> = T extends Type.int64 ? BigInt : number

export function serializeFloat(value: number, type: Type): Bytes<4 | 8> {
  switch (type) {
    case Type.float32: {
      const buffer = new ArrayBuffer(4)
      new DataView(buffer).setFloat32(0, value)

      return new Bytes(buffer)
    }
    case Type.float64: {
      const buffer = new ArrayBuffer(8)
      new DataView(buffer).setFloat64(0, value)

      return new Bytes(buffer)
    }
    default: {
      throw new Error(`Type "${type}" is not supported on float serialization`)
    }
  }
}

export function deserializeFloat<T extends Type.float32 | Type.float64>(
  type: T,
  value: T extends Type.float32 ? Bytes<4> : Bytes<8>,
): number {
  switch (type) {
    case Type.float32: {
      if (value.length !== 4) throw new NumberDeserialisationError('float', 4, value.length)

      return new DataView(value).getFloat32(0)
    }
    case Type.float64: {
      if (value.length !== 8) throw new NumberDeserialisationError('float', 8, value.length)

      return new DataView(value).getFloat64(0)
    }
    default: {
      throw new Error(`Type "${type}" is not supported on float deserialization`)
    }
  }
}

export function serliazeInt<T extends Type>(value: NumberValue<T>, type: T): Bytes<8> {
  if (typeof value === 'bigint') {
    if (type !== Type.int64) {
      throw new Error(`Got bigint value on serlializeInt function call with int64 type`)
    }

    const buffer = new ArrayBuffer(8)
    new DataView(buffer).setBigInt64(0, value)

    return new Bytes(buffer)
  }

  assertNumber(value)
  switch (type) {
    case Type.int8 || Type.uint8: {
      return new Bytes([value])
    }
    case Type.int16: {
      const buffer = new ArrayBuffer(2)
      new DataView(buffer).setInt16(0, value)

      return new Bytes(buffer)
    }
    case Type.int32: {
      const buffer = new ArrayBuffer(4)
      new DataView(buffer).setInt32(0, value)

      return new Bytes(buffer)
    }
    default: {
      throw new Error(`Type "${type}" is not supported on integer serialization`)
    }
  }
}

export function serializeUint32(value: number): Bytes<4> {
  const buffer = new ArrayBuffer(4)
  new DataView(buffer).setUint32(0, value)

  return new Bytes(buffer)
}

export function deserializeUint32(value: Bytes<4>): number {
  return new DataView(value).getUint32(0)
}

export function serializeUint16(value: number): Bytes<2> {
  const buffer = new ArrayBuffer(2)
  new DataView(buffer).setUint16(0, value)

  return new Bytes(buffer)
}

export function deserializeUint16(value: Bytes<2>): number {
  return new DataView(value).getUint16(0)
}

export function deserializeInt<T extends Type>(type: T, value: Uint8Array): NumberValue<T> {
  switch (type) {
    case Type.int8 || Type.uint8: {
      if (value.length !== 1) throw new NumberDeserialisationError('integer', 1, value.length)

      return value[0] as NumberValue<T>
    }
    case Type.int16: {
      if (value.length !== 2) throw new NumberDeserialisationError('integer', 2, value.length)

      return new DataView(value.buffer).getInt16(0) as NumberValue<T>
    }
    case Type.int32: {
      if (value.length !== 4) throw new NumberDeserialisationError('integer', 4, value.length)

      return new DataView(value.buffer).getInt32(0) as NumberValue<T>
    }
    case Type.int64: {
      if (value.length !== 8) throw new NumberDeserialisationError('integer', 8, value.length)

      return new DataView(value.buffer).getBigInt64(0) as unknown as NumberValue<T>
    }
    default: {
      throw new Error(`Type "${type}" is not supported on integer serialization`)
    }
  }
}
