import { BeeSon } from '../../beeson'
import { JsonValue } from '../../types'

export const name = 'beeson'

export const code = 0xfc

/**
 * @param {BeeSon<JsonValue>} node
 * @returns {ByteView<Uint8Array>}
 */
export const encode = (node: BeeSon<JsonValue>): Uint8Array => {
  return node.serialize()
}

/**
 * @param {ByteView<Uint8Array>} dataBytes
 * @returns {Uint8Array}
 */
export const decode = async (dataBytes: Uint8Array): Promise<BeeSon<JsonValue>> => {
  return BeeSon.deserialize(dataBytes)
}
