import { makeChunkedFile } from '@fairdatasociety/bmt-js'
import { BeeSon, Type } from '../../src'
import { HEADER_BYTE_LENGTH } from '../../src/type-specification'
import { Reference } from '../../src/types'
import { SEGMENT_SIZE } from '../../src/utils'
export { Reference } from '../../src/types'

interface TestBuddy {
  name: string
  age: number
  id: string
}
interface TestDataMain extends TestBuddy {
  buddies: TestBuddy[]
}

function createStorage() {
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

describe('superbeeson', () => {
  /** used only for deserialization, its attributes shouldn't change */
  const json: TestDataMain = {
    name: 'john coke',
    age: 48,
    id: 'ID2',
    buddies: [{ name: 'jesus', age: 33, id: 'ID1' }],
  }

  it('should serialize object', async () => {
    const beeson = new BeeSon<TestDataMain>({ json })
    const beesonBytes = beeson.serialize()
    const beesonTypeSpecBytes = beeson.typeSpecificationManager.serialize()
    expect(beeson.typeSpecificationManager.type).toBe(Type.object)
    expect(beeson.superBeeSon).toBe(false)
    beeson.superBeeSon = true
    expect(beeson.typeSpecificationManager.type).toBe(Type.object)
    expect(beeson.superBeeSon).toBe(true)
    const superBeesonBytes = beeson.serialize()
    // the segment size is the TypeSpecification reference
    expect(superBeesonBytes.length).toBe(
      beesonBytes.length - beesonTypeSpecBytes.length + HEADER_BYTE_LENGTH + SEGMENT_SIZE,
    )

    // check the parts of the BeeSon corresponds to its byte serialisation indices
    const typeSpecificationAddress = makeChunkedFile(beesonTypeSpecBytes).address()
    expect(typeSpecificationAddress).toStrictEqual(
      superBeesonBytes.slice(HEADER_BYTE_LENGTH, HEADER_BYTE_LENGTH + SEGMENT_SIZE),
    )
    // after the headers and typeSpecifications the payloads are matching.
    expect(superBeesonBytes.slice(HEADER_BYTE_LENGTH + SEGMENT_SIZE)).toStrictEqual(
      beesonBytes.slice(beesonTypeSpecBytes.length),
    )
  })

  it('should deserialize object', async () => {
    const storage = createStorage()
    const beeson = new BeeSon<TestDataMain>({ json })
    const beesonTypeSpecBytes = beeson.typeSpecificationManager.serialize()
    const typeRef = makeChunkedFile(beesonTypeSpecBytes).address()
    storage.storageSaverSync(typeRef, beesonTypeSpecBytes)
    beeson.superBeeSon = true
    const beesonBytes = beeson.serialize()
    const beesonAgain = await BeeSon.deserialize(beesonBytes, undefined, storage.storageLoader)
    expect(beesonAgain.json).toStrictEqual(beeson.json)
  })

  it('should serialize/deserialize superbeeson attribute', async () => {
    const storage = createStorage()
    const beeson = new BeeSon<TestDataMain>({ json })
    const beesonBytesFull = beeson.serialize()
    const typeSpecBytes = beeson.typeSpecificationManager.serialize()
    const buddiesArray = beeson.typeSpecificationManager.typeDefinitions.filter(
      t => t.marker === 'buddies',
    )[0]
    const buddiesTypeSpecBytes = buddiesArray.beeSon.typeSpecificationManager.serialize()
    const typeRef = makeChunkedFile(buddiesTypeSpecBytes).address()
    storage.storageSaverSync(typeRef, buddiesTypeSpecBytes)

    buddiesArray.beeSon.superBeeSon = true
    const superBeesonBytes = beeson.serialize()
    const superTypeSpecBytes = beeson.typeSpecificationManager.serialize()
    // new typeSpecificationBytes should be bigger than the original one with the referenced abi spec.
    expect(superTypeSpecBytes.length).toBe(typeSpecBytes.length + SEGMENT_SIZE)
    // superBeeSonBytes should be greater by segment size because its arra element segments padded with zeros
    expect(superBeesonBytes.length).toBe(beesonBytesFull.length + SEGMENT_SIZE)
    const beesonAgain = await BeeSon.deserialize(superBeesonBytes, undefined, storage.storageLoader)
    expect(beesonAgain.json).toStrictEqual(beeson.json)
  })
})
