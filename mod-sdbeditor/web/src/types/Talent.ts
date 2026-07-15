export interface Talent {
  ID: number;
  TabID: number;
  TierID: number;
  ColumnIndex: number;
  SpellRank: number[]; // 9 elements
  PrereqTalent: number[]; // 3 elements
  PrereqRank: number[]; // 3 elements
  Flags: number;
  RequiredSpellID: number;
  CategoryMask: number[]; // 2 elements
}
