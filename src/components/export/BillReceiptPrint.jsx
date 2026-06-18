import { forwardRef } from 'react';
import { format } from 'date-fns';

/**
 * Printable Payment Receipt — Bienvenido Big Bend pays the cleaner.
 * Props:
 *   items        – PayoutItem[] for ONE cleaner / bill
 *   cleaner      – Cleaner record
 *   run          – PayoutRun record
 *   companyInfo  – { name, address_line1, address_line2, website, logo_url }
 */
const BillReceiptPrint = forwardRef(({ items = [], cleaner = {}, run = {}, companyInfo = {} }, ref) => {
  const sortedItems = [...items].sort((a, b) => (a.checkout_date || '').localeCompare(b.checkout_date || ''));
  const total = sortedItems.reduce((s, i) => s + (i.amount || 0), 0);
  const billNumber = items[0]?.bill_number || '';
  const periodStartDate = run.start_date
   ? format(new Date(`${run.start_date}T12:00:00`), 'MMMM d')
    : '';
  const periodEndDate = run.end_date
   ? format(new Date(`${run.end_date}T12:00:00`), 'd, yyyy')
   : '';
  const cleaningPeriod =
     periodStartDate && periodEndDate
     ? `Cleaning Period: ${periodStartDate} - ${periodEndDate}`
      : 'Cleaning Period: —';
  const reportRunDate = format(new Date(), 'MMMM d, yyyy');
  const companyName = companyInfo.name || 'Bienvenido Big Bend';
  const headerColor = companyInfo.header_color || '#1a1a2e';
  const accentColor = companyInfo.accent_color || '#4f6ef7';

  return (
    <div ref={ref} style={{
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: '11px',
      color: '#1a1a2e',
      padding: '48px 56px',
      maxWidth: '760px',
      margin: '0 auto',
      backgroundColor: '#fff',
    }}>

      {/* ── Header: Logo left, Company right ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '36px' }}>
        <div>
          {companyInfo.logo_url ? (
            <img src={companyInfo.logo_url} alt="Logo" style={{ maxHeight: '64px', maxWidth: '180px', objectFit: 'contain', marginBottom: '8px' }} />
          ) : (
            <div style={{ fontWeight: '800', fontSize: '20px', color: '#1a1a2e', letterSpacing: '-0.5px', lineHeight: '1.2' }}>
              {companyName}
            </div>
          )}
          <div style={{ color: '#666', fontSize: '10px', lineHeight: '1.7', marginTop: '4px' }}>
            {companyInfo.address_line1 && <div>{companyInfo.address_line1}</div>}
            {companyInfo.address_line2 && <div>{companyInfo.address_line2}</div>}
            {companyInfo.website && <div>{companyInfo.website}</div>}
          </div>
        </div>

        {/* Receipt label + number */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a2e', letterSpacing: '-0.5px' }}>PAYMENT RECEIPT</div>
          <div style={{ color: '#888', fontSize: '10px', marginTop: '6px' }}>Receipt #</div>
          <div style={{ fontWeight: '700', fontSize: '13px', fontFamily: 'Courier New, monospace' }}>{billNumber}</div>
        </div>
      </div>

      {/* ── Thin accent bar ── */}
      <div style={{ height: '3px', background: `linear-gradient(90deg, ${headerColor} 0%, ${accentColor} 60%, ${accentColor}88 100%)`, borderRadius: '2px', marginBottom: '28px' }} />

      {/* ── Payment confirmed banner ── */}
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '28px' }}>
        <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ color: '#fff', fontSize: '12px', fontWeight: 'bold', lineHeight: 1 }}>✓</span>
        </div>
        <div>
          <div style={{ fontWeight: '700', fontSize: '12px', color: '#15803d' }}>Payment Confirmed</div>
          <div style={{ color: '#166534', fontSize: '10px' }}>This receipt confirms payment issued on {reportRunDate}</div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: '10px', color: '#888' }}>Amount Paid</div>
          <div style={{ fontSize: '20px', fontWeight: '800', color: '#15803d', fontFamily: 'Courier New, monospace' }}>${total.toFixed(2)}</div>
        </div>
      </div>

      {/* ── Payment From / Payment To ── */}
      <div style={{ display: 'flex', gap: '32px', marginBottom: '28px' }}>
        <div style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px 16px' }}>
          <div style={{ fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: '6px' }}>Payment From</div>
          <div style={{ fontWeight: '700', fontSize: '13px', color: '#1a1a2e', marginBottom: '3px' }}>{companyName}</div>
          {companyInfo.address_line1 && <div style={{ color: '#64748b', fontSize: '10px', lineHeight: '1.6' }}>{companyInfo.address_line1}</div>}
          {companyInfo.address_line2 && <div style={{ color: '#64748b', fontSize: '10px' }}>{companyInfo.address_line2}</div>}
          {companyInfo.website && <div style={{ color: '#64748b', fontSize: '10px' }}>{companyInfo.website}</div>}
        </div>
        <div style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px 16px' }}>
          <div style={{ fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: '6px' }}>Payment To</div>
          <div style={{ fontWeight: '700', fontSize: '13px', color: '#1a1a2e', marginBottom: '3px' }}>{cleaner.cleaner_name || '—'}</div>
          {cleaner.mailing_address && <div style={{ color: '#64748b', fontSize: '10px', lineHeight: '1.6', whiteSpace: 'pre-line' }}>{cleaner.mailing_address}</div>}
          {cleaner.email && <div style={{ color: '#64748b', fontSize: '10px', marginTop: '2px' }}>{cleaner.email}</div>}
        </div>
        <div style={{ minWidth: '160px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px 16px' }}>
          <div style={{ fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: '6px' }}>Payment Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', fontSize: '10px' }}>
            <span style={{ color: '#94a3b8' }}>Date</span>
            <span style={{ color: '#1a1a2e', fontWeight: '600' }}>{reportRunDate}</span>
            <span style={{ color: '#94a3b8' }}>Ref #</span>
            <span style={{ color: '#1a1a2e', fontWeight: '600', fontFamily: 'Courier New, monospace', fontSize: '9px' }}>{billNumber}</span>
            <span style={{ color: '#94a3b8' }}>Period</span>
            <span style={{ color: '#1a1a2e', fontWeight: '600' }}>{cleaningPeriod.replace('Cleaning Period: ', '')}</span>
          </div>
        </div>
      </div>

      {/* ── Line items table ── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0' }}>
        <thead>
          <tr style={{ background: headerColor }}>
            <th style={{ textAlign: 'left', padding: '9px 12px', color: '#e2e8f0', fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Completed Date</th>
            <th style={{ textAlign: 'left', padding: '9px 12px', color: '#e2e8f0', fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Description</th>
            <th style={{ textAlign: 'left', padding: '9px 12px', color: '#e2e8f0', fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Property / Class</th>
            <th style={{ textAlign: 'left', padding: '9px 12px', color: '#e2e8f0', fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Fee Type</th>
            <th style={{ textAlign: 'right', padding: '9px 12px', color: '#e2e8f0', fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((item, idx) => (
            <tr key={idx} style={{ background: idx % 2 === 0 ? '#ffffff' : '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <td style={{ padding: '10px 12px', verticalAlign: 'top', color: '#475569', fontSize: '10px', fontFamily: 'Courier New, monospace' }}>
                {item.checkout_date ? format(new Date(item.checkout_date), 'MM/dd/yyyy') : '—'}
              </td>
              <td style={{ padding: '10px 12px', verticalAlign: 'top', color: '#334155', fontSize: '10px' }}>{item.description || '—'}</td>
              <td style={{ padding: '10px 12px', verticalAlign: 'top', color: '#475569', fontSize: '10px' }}>{item.qbo_class || item.listing_name || '—'}</td>
              <td style={{ padding: '10px 12px', verticalAlign: 'top', color: '#475569', fontSize: '10px' }}>{item.fee_type || '—'}</td>
              <td style={{ padding: '10px 12px', verticalAlign: 'top', textAlign: 'right', fontWeight: '600', fontFamily: 'Courier New, monospace', color: '#1a1a2e' }}>${(item.amount || 0).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Total box ── */}
      <div style={{ borderTop: '2px solid #1a1a2e', marginTop: '0' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 12px 4px', fontSize: '11px', color: '#64748b' }}>
          <span style={{ marginRight: '40px' }}>Subtotal</span>
          <span style={{ fontFamily: 'Courier New, monospace', minWidth: '80px', textAlign: 'right' }}>${total.toFixed(2)}</span>
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', background: headerColor, padding: '12px 12px', marginTop: '4px' }}>
          <span style={{ fontWeight: '700', fontSize: '12px', color: '#e2e8f0', marginRight: '40px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Paid</span>
          <span style={{ fontFamily: 'Courier New, monospace', fontWeight: '800', fontSize: '18px', color: '#ffffff', minWidth: '80px', textAlign: 'right' }}>${total.toFixed(2)}</span>
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ marginTop: '36px', paddingTop: '16px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '9px', color: '#94a3b8' }}>
          {companyName} · {companyInfo.website || ''}<br />
          This document serves as official confirmation of payment.
        </div>
        <div style={{ fontSize: '9px', color: '#94a3b8', textAlign: 'right' }}>
          Generated {format(new Date(), 'MM/dd/yyyy')}<br />
          {billNumber}
        </div>
      </div>

    </div>
  );
});

BillReceiptPrint.displayName = 'BillReceiptPrint';
export default BillReceiptPrint;