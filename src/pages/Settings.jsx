import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Save, Loader2, Settings2, Link2, DollarSign } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getBusinessId, isSystemAdmin } from '@/lib/roles';

export default function Settings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const businessId = getBusinessId(user);
  const userIsSystemAdmin = isSystemAdmin(user);
  const queryEnabled = Boolean(user) && (userIsSystemAdmin || Boolean(businessId));
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState({});

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ['appSettings', businessId, userIsSystemAdmin],
    enabled: queryEnabled,
    queryFn: () => userIsSystemAdmin
      ? base44.entities.AppSetting.list()
      : base44.entities.AppSetting.filter({ business_id: businessId }),
    initialData: [],
  });

  useEffect(() => {
    const map = {};
    settings.forEach(s => { map[s.setting_key] = s.setting_value; });
    setValues(map);
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    for (const setting of settings) {
      if (values[setting.setting_key] !== setting.setting_value) {
        await base44.entities.AppSetting.update(setting.id, { setting_value: values[setting.setting_key] });
      }
    }
    toast.success('Settings saved');
    setSaving(false);
    qc.invalidateQueries({ queryKey: ['appSettings'] });
  };

  const update = (key, val) => setValues(v => ({ ...v, [key]: val }));

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Configure payout rules and API connections"
        actions={
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Settings
          </Button>
        }
      />

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Payout Rules */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><DollarSign className="w-4 h-4" />Payout Rules</CardTitle>
            <CardDescription>Configure how cleaner payouts are calculated</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm">Cleaning Fee Difference Threshold ($)</Label>
              <p className="text-xs text-muted-foreground mb-1">If QBO fee minus task cost exceeds tolerance, pay QBO fee minus this amount</p>
              <Input
                type="number" step="0.01"
                value={values.cleaning_fee_diff_threshold || ''}
                onChange={e => update('cleaning_fee_diff_threshold', e.target.value)}
              />
            </div>
            <div>
              <Label className="text-sm">Cleaning Fee Difference Tolerance ($)</Label>
              <p className="text-xs text-muted-foreground mb-1">Threshold before flagging QBO fee vs task cost difference</p>
              <Input
                type="number" step="0.01"
                value={values.cleaning_fee_diff_tolerance || ''}
                onChange={e => update('cleaning_fee_diff_tolerance', e.target.value)}
              />
            </div>
            <div>
              <Label className="text-sm">Pet Fee Payout Percentage (%)</Label>
              <p className="text-xs text-muted-foreground mb-1">Percentage of pet fee paid to the cleaner</p>
              <Input
                type="number" step="1"
                value={values.pet_fee_payout_pct || ''}
                onChange={e => update('pet_fee_payout_pct', e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* API Connections */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Link2 className="w-4 h-4" />API Connections</CardTitle>
            <CardDescription>Configure for future API integration (CSV import works now)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm">Hostaway API Key</Label>
              <Input
                type="password"
                value={values.hostaway_api_key || ''}
                onChange={e => update('hostaway_api_key', e.target.value)}
                placeholder="Enter API key when ready"
              />
            </div>
            <div>
              <Label className="text-sm">Hostaway Account ID</Label>
              <Input
                value={values.hostaway_account_id || ''}
                onChange={e => update('hostaway_account_id', e.target.value)}
                placeholder="Enter account ID"
              />
            </div>
            <div>
              <Label className="text-sm">QuickBooks Company ID</Label>
              <Input
                value={values.qbo_company_id || ''}
                onChange={e => update('qbo_company_id', e.target.value)}
                placeholder="Enter company ID"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-sm">QuickBooks Connection</Label>
                <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200">
                  {values.qbo_connection_status || 'Not Connected'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">API connections will be available in a future update. CSV upload is fully functional now.</p>
            </div>
          </CardContent>
        </Card>

        {/* Company Info */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Settings2 className="w-4 h-4" />Company Info &amp; Receipt Branding</CardTitle>
            <CardDescription>Appears on printed payout receipts — customize colors and logo</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              {/* Left: text fields */}
              <div className="space-y-4">
                <div>
                  <Label className="text-sm">Company Name</Label>
                  <Input value={values.company_name || ''} onChange={e => update('company_name', e.target.value)} placeholder="Bienvenido Big Bend" />
                </div>
                <div>
                  <Label className="text-sm">Address Line 1</Label>
                  <Input value={values.company_address_line1 || ''} onChange={e => update('company_address_line1', e.target.value)} placeholder="PO Box 1235, Alpine, TX 79831 US" />
                </div>
                <div>
                  <Label className="text-sm">Address Line 2</Label>
                  <Input value={values.company_address_line2 || ''} onChange={e => update('company_address_line2', e.target.value)} placeholder="(optional)" />
                </div>
                <div>
                  <Label className="text-sm">Website</Label>
                  <Input value={values.company_website || ''} onChange={e => update('company_website', e.target.value)} placeholder="www.example.com" />
                </div>
              </div>

              {/* Right: logo + colors */}
              <div className="space-y-4">
                {/* Logo upload */}
                <div>
                  <Label className="text-sm">Logo</Label>
                  <div className="mt-1 flex items-start gap-3">
                    <div className="w-24 h-16 rounded border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                      {values.company_logo_url
                        ? <img src={values.company_logo_url} alt="Logo preview" className="max-w-full max-h-full object-contain" />
                        : <span className="text-xs text-muted-foreground text-center px-1">No logo</span>
                      }
                    </div>
                    <div className="flex-1 space-y-2">
                      <Input value={values.company_logo_url || ''} onChange={e => update('company_logo_url', e.target.value)} placeholder="Paste image URL…" className="text-xs" />
                      <p className="text-xs text-muted-foreground">Paste a public image URL (PNG, JPG, SVG)</p>
                    </div>
                  </div>
                </div>

                {/* Colors */}
                <div>
                  <Label className="text-sm">Receipt Header Color</Label>
                  <p className="text-xs text-muted-foreground mb-1">Background color for table headers and total bar</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={values.receipt_header_color || '#1a1a2e'}
                      onChange={e => update('receipt_header_color', e.target.value)}
                      className="w-10 h-9 rounded border cursor-pointer p-0.5"
                    />
                    <Input
                      value={values.receipt_header_color || '#1a1a2e'}
                      onChange={e => update('receipt_header_color', e.target.value)}
                      placeholder="#1a1a2e"
                      className="font-mono text-xs w-32"
                    />
                    <span className="text-xs text-muted-foreground">Preview:</span>
                    <div className="h-7 w-20 rounded text-white text-xs flex items-center justify-center font-semibold" style={{ background: values.receipt_header_color || '#1a1a2e' }}>Header</div>
                  </div>
                </div>

                <div>
                  <Label className="text-sm">Receipt Accent Color</Label>
                  <p className="text-xs text-muted-foreground mb-1">Used for the accent bar below the company name</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={values.receipt_accent_color || '#4f6ef7'}
                      onChange={e => update('receipt_accent_color', e.target.value)}
                      className="w-10 h-9 rounded border cursor-pointer p-0.5"
                    />
                    <Input
                      value={values.receipt_accent_color || '#4f6ef7'}
                      onChange={e => update('receipt_accent_color', e.target.value)}
                      placeholder="#4f6ef7"
                      className="font-mono text-xs w-32"
                    />
                    <span className="text-xs text-muted-foreground">Preview:</span>
                    <div className="h-7 w-20 rounded text-white text-xs flex items-center justify-center font-semibold" style={{ background: values.receipt_accent_color || '#4f6ef7' }}>Accent</div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Settings2 className="w-4 h-4" />About</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p><strong>CleanPay</strong> — Cleaner Payout Automation</p>
            <p>Replaces manual Excel workbook process for calculating short-term rental cleaner payouts.</p>
            <p className="text-xs">Key rule: Cleaning rate is determined by reservation created date, not check-in, checkout, or cleaning date.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}