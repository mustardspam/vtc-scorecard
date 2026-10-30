// ERP (Dynamic Builder) reports, pulled through ResPlan. Read-only: a pull runs a report.

export function createErpClient(resplan) {
  return {
    /** Schedule adherence for a month ("YYYY-MM"), month to date. */
    getSchedule: (brand, month, onStep) => resplan.pull('schedule', brand, month, onStep),
    /** Backcharges for a month, month to date. */
    getReworkBackcharges: (brand, month, onStep) => resplan.pull('rework', brand, month, onStep),
    /** JC Preferred Vendors: the current vendor / community / cost code assignments. */
    getJcVendorReport: (brand, onStep) => resplan.pull('jc_vendor_report', brand, null, onStep),
  }
}
