/** A plan laid out like Bintang Fremont's: rows of courts, an aisle, and a front desk. */
const ROWS = [
  [53, 52, 51, 50, 49, 48],
  [47, 46, 45, 44, 43, 42, 41],
  [40, 39, 38, 37, 36, 35, 34],
  [33, 32, 31, 30, 29, 28, 27],
  [26, 25, 24, 23, 22, 21, 20],
  [19, 18, 17, 16, 15, 14, 13],
  [12, 11, 10, 9, 8, 7, 6],
  [5, null, null, 4, 3, 2, 1],
];
export const plan = {
  aspect: 1.39,
  items: [
    ...ROWS.flatMap((row, y) =>
      row.flatMap((n, x) =>
        n === null
          ? []
          : [
              {
                kind: "court",
                label: String(n),
                x: 0.02 + x * 0.14 + (y === 0 ? 0.07 : 0),
                y: 0.02 + y * 0.085 + (y >= 3 ? 0.04 : 0),
                w: 0.11,
                h: 0.055,
              },
            ],
      ),
    ),
    { kind: "text", label: "BADMINTON COURTS", x: 0.35, y: 0.275, w: 0.3, h: 0.03 },
    { kind: "area", label: "JR", x: 0.9, y: 0.75, w: 0.07, h: 0.15 },
    { kind: "area", label: "FRONT DESK", x: 0.68, y: 0.82, w: 0.14, h: 0.08 },
  ],
};
