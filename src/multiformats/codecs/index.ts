import { BeeSon } from '../../beeson'
import { JsonValue } from '../../types'
import { createStorage } from '../../utils'

export const name = 'beeson'

export const code = 0xfc

export const typeManagerStorageResolver = createStorage()

export const encode = (node: BeeSon<JsonValue>): Uint8Array => {
  const { swarmAddress, bytes } = node.typeManager.superBeeSonAttributes()
  typeManagerStorageResolver.storageSaverSync(swarmAddress, bytes)

  return node.serialize()
}

export const decode = async (dataBytes: Uint8Array): Promise<BeeSon<JsonValue>> => {
  return BeeSon.deserialize(dataBytes, undefined, typeManagerStorageResolver.storageLoader)
}
