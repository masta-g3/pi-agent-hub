import test from "node:test";
import assert from "node:assert/strict";
import { qrMatrix } from "../src/core/qr.js";
import { QR_VECTORS } from "./fixtures/qr-vectors.js";

const rows = (matrix: boolean[][]) => matrix.map((row) => row.map((dark) => (dark ? "1" : "0")).join(""));

for (const vector of QR_VECTORS) {
  test(`QR ${vector.name} matches the reference encoder at a fixed mask`, () => {
    const matrix = qrMatrix(vector.text, vector.mask);
    assert.ok(matrix);
    assert.equal(matrix.length, 17 + 4 * vector.version);
    assert.deepEqual(rows(matrix), vector.rows);
  });

  test(`QR ${vector.name} picks the reference encoder's mask`, () => {
    const auto = qrMatrix(vector.text);
    const expected = qrMatrix(vector.text, vector.autoMask);
    assert.ok(auto && expected);
    assert.deepEqual(rows(auto), rows(expected));
  });
}

test("QR stops at 213 bytes, version 10", () => {
  assert.equal(qrMatrix("a".repeat(213))?.length, 57);
  assert.equal(qrMatrix("a".repeat(214)), undefined);
  // UTF-8 bytes count, not characters: 107 two-byte letters are 214 bytes.
  assert.equal(qrMatrix("é".repeat(107)), undefined);
});
