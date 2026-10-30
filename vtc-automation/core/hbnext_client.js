// HB NEXT safety OFIs, pulled through ResPlan (Ashton Woods only). Read-only.

export function createHbnextClient(resplan) {
  return {
    /** Safety OFIs for a month ("YYYY-MM"), month to date. */
    getSafetyOfis: (month, onStep) => resplan.pull('safety', 'Ashton Woods', month, onStep),
  }
}
