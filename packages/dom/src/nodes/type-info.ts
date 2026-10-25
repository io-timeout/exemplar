import { DTD_TYPES } from '../names.ts';

/** An element's or attribute's type: the DTD type of an attribute, as DOM Level 3's TypeInfo gives it. */
export class TypeInfo {
  static readonly DERIVATION_RESTRICTION = 0x01;
  static readonly DERIVATION_EXTENSION = 0x02;
  static readonly DERIVATION_UNION = 0x04;
  static readonly DERIVATION_LIST = 0x08;
  readonly typeName: string | null;
  readonly typeNamespace: string | null;

  constructor(typeName: string | null) {
    this.typeName = typeName;
    this.typeNamespace = typeName === null ? null : DTD_TYPES;
  }

  /** DTD types derive from nothing. */
  isDerivedFrom(_namespace: string | null, _name: string | null, _method: number): boolean {
    return false;
  }
}

export const NO_TYPE = new TypeInfo(null);
