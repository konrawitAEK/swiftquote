// Bridge to the types generated from contracts/openapi.yaml (`make gen-types`). Every model extends
// these, so the interfaces always match the contract.
import type { components } from '../api/schema'

export type Generated<K extends keyof components['schemas']> = components['schemas'][K]
