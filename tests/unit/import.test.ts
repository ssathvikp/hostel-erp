import { describe, expect, it } from "vitest";

import { normaliseDate, parseImport, templateCsv } from "@/features/import/spec";
import { parseCsv } from "@/lib/csv";

describe("CSV reading", () => {
  it("handles quotes, escaped quotes, line breaks in quotes and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"two\nlines",z\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["two\nlines", "z"],
    ]);
  });

  it("reads semicolon files, drops a byte-order mark and skips blank lines", () => {
    expect(parseCsv("﻿room;floor\n\n101;1\n;\n")).toEqual([
      ["room", "floor"],
      ["101", "1"],
    ]);
  });
});

describe("dates people type", () => {
  it("reads Indian day-first dates and leaves ISO dates alone", () => {
    expect(normaliseDate("01-06-2026")).toBe("2026-06-01");
    expect(normaliseDate("1/6/2026")).toBe("2026-06-01");
    expect(normaliseDate("14.05.2002")).toBe("2002-05-14");
    expect(normaliseDate("2026-06-01")).toBe("2026-06-01");
    expect(normaliseDate("June 1")).toBe("June 1");
  });
});

describe("room import", () => {
  it("accepts friendly headers and sharing words, filling in capacity", () => {
    const { fileErrors, rows } = parseImport(
      "rooms",
      "Room No,Floor,Sharing Type,Beds\n101,1,Double,\n102,1,4+,5\n103a,1,1,",
    );
    expect(fileErrors).toEqual([]);
    expect(rows.map((row) => row.data)).toEqual([
      { room_number: "101", floor: 1, sharing_type: "double", capacity: 2 },
      { room_number: "102", floor: 1, sharing_type: "four_plus", capacity: 5 },
      { room_number: "103A", floor: 1, sharing_type: "single", capacity: 1 },
    ]);
  });

  it("reports bad rows by line, and repeated room numbers", () => {
    const { rows } = parseImport(
      "rooms",
      "room_number,floor,sharing_type,capacity\n101,1,double,3\n102,x,single,\n101,2,single,",
    );
    expect(rows[0]).toMatchObject({ line: 2, data: null });
    expect(rows[0].errors[0]).toContain("capacity: Capacity does not match the sharing type");
    expect(rows[1].errors[0]).toMatch(/^floor:/);
    expect(rows[2].errors).toEqual([]);
    expect(
      parseImport("rooms", "room_number,floor,sharing_type\n7,1,single\n7,1,single").rows[1].errors,
    ).toEqual(["Same room 7 as line 2"]);
  });

  it("explains a file without the right columns, or too many rows", () => {
    expect(parseImport("rooms", "name,beds\nA,2").fileErrors[0]).toContain(
      "Missing: room_number, floor, sharing_type",
    );
    expect(parseImport("rooms", "room_number,floor,sharing_type").fileErrors).toEqual([
      "The file has a header but no rows.",
    ]);
    const big = [
      "room_number,floor,sharing_type",
      ...Array.from({ length: 501 }, (_, i) => `${i + 1},1,single`),
    ];
    expect(parseImport("rooms", big.join("\n")).fileErrors[0]).toContain("at most 500 rows");
  });

  it("offers a template that imports cleanly", () => {
    const { fileErrors, rows } = parseImport("rooms", templateCsv("rooms"));
    expect(fileErrors).toEqual([]);
    expect(rows[0].errors).toEqual([]);
  });
});

describe("resident import", () => {
  const header = "name,mobile,gender,dob,id_proof_type,id_proof_number,address,joining_date,email";

  it("validates each resident with the registration rules", () => {
    const { rows } = parseImport(
      "residents",
      [
        header,
        "Ravi Kumar,98765 43210,M,14-05-2002,Aadhar,2345 6789 0123,12 Station Road,01-06-2026,RAVI@example.com",
        "Too Young,9876500000,female,01-01-2020,aadhaar,234567890124,Somewhere,01-06-2026,",
      ].join("\n"),
    );
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].data).toMatchObject({
      full_name: "Ravi Kumar",
      phone: "9876543210",
      gender: "male",
      dob: "2002-05-14",
      id_proof_type: "aadhaar",
      id_proof_number: "234567890123",
      email: "ravi@example.com",
      alt_phone: null,
    });
    expect(rows[1].errors[0]).toMatch(/^dob: Resident must be between/);
  });

  it("flags the same mobile or ID twice in one file", () => {
    const { rows } = parseImport(
      "residents",
      [
        header,
        "A One,9876543210,male,14-05-2002,aadhaar,234567890123,Addr,01-06-2026,",
        "B Two,9876543210,male,14-05-2002,aadhaar,234567890999,Addr,01-06-2026,",
        "C Three,9876543211,male,14-05-2002,aadhaar,234567890123,Addr,01-06-2026,",
      ].join("\n"),
    );
    expect(rows[1].errors).toEqual(["Same mobile 9876543210 as line 2"]);
    expect(rows[2].errors).toEqual(["Same ID aadhaar 234567890123 as line 2"]);
  });

  it("offers a template that imports cleanly", () => {
    const { rows } = parseImport("residents", templateCsv("residents"));
    expect(rows[0].errors).toEqual([]);
  });
});
