// DBC File Parser for WoW database files
export interface DBCRecord {
  [key: string]: any;
}

export interface DBCFile {
  signature: string;
  fieldCount: number;
  recordCount: number;
  fieldSize: number;
  stringBlockSize: number;
  records: DBCRecord[];
  fieldNames: string[];
  fieldTypes: string[];
  stringBlock: string;
}

export class DBCParser {
  static parseDBCFile(buffer: ArrayBuffer): DBCFile {
    const view = new DataView(buffer);
    let offset = 0;

    // Read signature (4 bytes)
    const signature = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    offset += 4;

    if (signature !== "WDBC") {
      throw new Error(`Invalid DBC signature: ${signature}`);
    }

    // Read header
    const fieldCount = view.getUint32(offset, true);
    offset += 4;
    const recordCount = view.getUint32(offset, true);
    offset += 4;
    const fieldSize = view.getUint32(offset, true);
    offset += 4;
    const stringBlockSize = view.getUint32(offset, true);
    offset += 4;

    // Read records
    const records: DBCRecord[] = [];
    const recordData = new Uint32Array(buffer, offset, recordCount * fieldCount);

    for (let i = 0; i < recordCount; i++) {
      const record: DBCRecord = {};
      for (let j = 0; j < fieldCount; j++) {
        record[`field_${j}`] = recordData[i * fieldCount + j];
      }
      records.push(record);
    }

    offset += recordCount * fieldSize;

    // Read string block
    const stringBlockBuffer = buffer.slice(offset, offset + stringBlockSize);
    const stringBlockView = new Uint8Array(stringBlockBuffer);
    const stringBlock = new TextDecoder().decode(stringBlockView);

    return {
      signature,
      fieldCount,
      recordCount,
      fieldSize,
      stringBlockSize,
      records,
      fieldNames: Array.from({ length: fieldCount }, (_, i) => `field_${i}`),
      fieldTypes: Array.from({ length: fieldCount }, () => "uint32"), // Default type
      stringBlock,
    };
  }

  static createDBCFile(records: DBCRecord[], fieldCount: number): Uint8Array {
    const fieldSize = fieldCount * 4;
    const recordCount = records.length;
    const stringBlockSize = 1; // Minimum

    // Create header
    const header = new Uint8Array(20);
    const headerView = new DataView(header.buffer);

    header[0] = 87; // 'W'
    header[1] = 68; // 'D'
    header[2] = 66; // 'B'
    header[3] = 67; // 'C'

    headerView.setUint32(4, fieldCount, true);
    headerView.setUint32(8, recordCount, true);
    headerView.setUint32(12, fieldSize, true);
    headerView.setUint32(16, stringBlockSize, true);

    // Create record data
    const recordBuffer = new Uint32Array(recordCount * fieldCount);
    records.forEach((record, i) => {
      for (let j = 0; j < fieldCount; j++) {
        recordBuffer[i * fieldCount + j] = record[`field_${j}`] || 0;
      }
    });

    // Combine all
    const totalSize = header.length + recordBuffer.byteLength + stringBlockSize;
    const result = new Uint8Array(totalSize);

    result.set(header, 0);
    result.set(new Uint8Array(recordBuffer.buffer), header.length);

    return result;
  }

  static stringAt(dbc: DBCFile, offset: number): string {
    if (offset === 0) return "";
    let end = offset;
    while (end < dbc.stringBlock.length && dbc.stringBlock[end] !== "\0") {
      end++;
    }
    return dbc.stringBlock.substring(offset, end);
  }
}

// Specialized parser for SpellIcon.dbc
export interface SpellIconRecord {
  id: number;
  iconPath: string;
}

export class SpellIconParser {
  static parse(dbc: DBCFile): SpellIconRecord[] {
    return dbc.records.map((record, index) => ({
      id: index,
      iconPath: DBCParser.stringAt(dbc, record.field_1 || 0),
    }));
  }

  static create(icons: SpellIconRecord[]): DBCFile {
    const records = icons.map((icon) => ({
      field_0: icon.id,
      field_1: icon.iconPath,
    }));

    return {
      signature: "WDBC",
      fieldCount: 2,
      recordCount: icons.length,
      fieldSize: 8,
      stringBlockSize: 1,
      records,
      fieldNames: ["id", "iconPath"],
      fieldTypes: ["uint32", "string"],
      stringBlock: "",
    };
  }
}
