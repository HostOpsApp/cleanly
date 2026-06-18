import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeResKey(confirmationCode, externalResId, reservationId, channel, channelReservationId) {
  const channelLower = (channel || '').toLowerCase();

  // Airbnb: use everything after the last hyphen in channelReservationId
  if (channelLower.includes('airbnb') && channelReservationId) {
    const parts = String(channelReservationId).trim().split('-');
    const code = parts[parts.length - 1].trim();
    if (code) return code.toUpperCase();
  }

  // Non-Airbnb: HM confirmation code or extract from externalResId
  if (confirmationCode && /^HM/i.test(confirmationCode)) return confirmationCode.toUpperCase();
  if (externalResId) {
    const hmMatch = String(externalResId).match(/HM\w{8}/i);
    if (hmMatch) return hmMatch[0].toUpperCase();
  }
  return String(reservationId);
}

function mapReservation(r, businessId) {
  const confirmationCode = r.confirmationCode || '';
  const externalResId = r.reservationId || '';
  const reservationId = String(r.id || '');
  const channel = r.channelName || '';
  const channelReservationId = String(r.channelReservationId || '');
  const normKey = normalizeResKey(confirmationCode, externalResId, reservationId, channel, channelReservationId);

  // Extract pet fee from reservationFees
  let petFeeValue = 0;
  if (Array.isArray(r.reservationFees)) {
    for (const fee of r.reservationFees) {
      const name = (fee.name || fee.type || '').toLowerCase();
      if (name.includes('pet')) {
        petFeeValue += parseFloat(fee.value || fee.amount || 0);
      }
    }
  }

  return {
    business_id: businessId,
    source_type: 'API',
    reservation_id: reservationId,
    hostaway_reservation_id: String(r.hostawayReservationId || ''),
    external_reservation_id: externalResId,
    channel_reservation_id: String(r.channelReservationId || ''),
    normalized_reservation_key: normKey,
    listing_name: r.listingName || (r.listing && r.listing.internalListingName) || '',
    hostaway_listing_id: String(r.listingMapId || ''),
    guest_name: r.guestName || '',
    check_in_date: r.arrivalDate || '',
    check_out_date: r.departureDate || '',
    reservation_created_date: r.reservationDate || '',
    reservation_date: r.reservationDate || '',
    cleaning_fee_value: parseFloat(r.cleaningFee || 0),
    pet_fee_value: petFeeValue,
    channel: r.channelName || '',
    status: r.status || '',
    confirmation_code: confirmationCode,
    reservation_fees_raw_json: JSON.stringify(r.reservationFees || []),
    api_raw_json: JSON.stringify(r),
    api_last_synced_at: new Date().toISOString(),
    import_status: 'Synced',
  };
}

function mapTask(t, businessId) {
  return {
    business_id: businessId,
    source_type: 'API',
    task_id: String(t.id || ''),
    task_title: t.title || '',
    description: t.description || '',
    status: t.status || '',
    reservation_id: String(t.reservationId || ''),
    normalized_reservation_key: String(t.reservationId || ''),
    hostaway_listing_id: String(t.listingMapId || ''),
    channel_id: String(t.channelId || ''),
    autotask_id: String(t.autoTaskId || ''),
    created_by_user_id: String(t.createdByUserId || ''),
    assignee_user_id: String(t.assigneeUserId || ''),
    assignee_user: t.assigneeUserName || t.assigneeFullName || t.assigneeUser || t.assigneeName || (t.assignee && (t.assignee.name || t.assignee.fullName || t.assignee.firstName)) || '',
    supervisor_user_id: String(t.supervisorUserId || ''),
    can_start_from: t.canStartFrom || '',
    started_at: t.startedAt || '',
    should_end_by: t.shouldEndBy || '',
    completed_at: t.completedAt || '',
    confirmed_at: t.confirmedAt || '',
    cost: parseFloat(t.cost || 0),
    cost_currency: t.costCurrency || 'USD',
    cost_description: t.costDescription || '',
    categories: JSON.stringify(t.categoriesMap || {}),
    api_raw_json: JSON.stringify(t),
    api_last_synced_at: new Date().toISOString(),
    import_status: 'Synced',
  };
}

async function getAccessToken(accountId, apiKey) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: accountId,
    client_secret: apiKey,
    scope: 'general',
  });
  const res = await fetch('https://api.hostaway.com/v1/accessTokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed ${res.status}: ${text}`);
  }
  const data = await res.json();
  return {
    access_token: data.access_token,
    expires_in: data.expires_in || 3600,
  };
}

async function fetchReservations(token, params = {}) {
  const qs = new URLSearchParams({ includeResources: '1', ...params });
  const res = await fetch(`https://api.hostaway.com/v1/reservations?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reservations fetch failed ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.result || data.data || [];
}

async function fetchUsers(token) {
  const res = await fetch('https://api.hostaway.com/v1/users', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Users fetch failed ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.result || data.data || [];
}

async function fetchTasks(token, params = {}) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`https://api.hostaway.com/v1/tasks?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tasks fetch failed ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.result || data.data || [];
}

// ─── Rate-limit-aware upsert helpers ─────────────────────────────────────────

async function withRetry(fn, retries = 5, delayMs = 2000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err?.message?.toLowerCase().includes('rate limit') || err?.status === 429;
      if (isRateLimit && attempt < retries) {
        const wait = delayMs * Math.pow(2, attempt); // exponential backoff
        console.error(`Rate limit hit, retrying in ${wait}ms (attempt ${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}

async function bulkUpsert(entity, toCreate, toUpdate, chunkSize = 5, delayMs = 1500) {
  for (let i = 0; i < toCreate.length; i += chunkSize) {
    await withRetry(() => entity.bulkCreate(toCreate.slice(i, i + chunkSize)));
    if (i + chunkSize < toCreate.length) await new Promise(r => setTimeout(r, delayMs));
  }
  for (let i = 0; i < toUpdate.length; i += chunkSize) {
    await withRetry(() => Promise.all(toUpdate.slice(i, i + chunkSize).map(u => entity.update(u.id, u.data))));
    if (i + chunkSize < toUpdate.length) await new Promise(r => setTimeout(r, delayMs));
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Base44 owns User.role (admin/user). CleanPay permissions use business_role.
  const normalizeRole = (role) => String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const readUserField = (field) => user?.[field] ?? user?.data?.[field] ?? user?.data?.data?.[field] ?? '';

  const base44Role = normalizeRole(readUserField('role'));
  const oldRoleFallback = normalizeRole(readUserField('role'));
  const businessRole = normalizeRole(
    readUserField('business_role') ||
    readUserField('app_role') ||
    (['owner_admin', 'manager', 'staff', 'cleaner'].includes(oldRoleFallback) ? oldRoleFallback : '')
  );

  const isAdmin = base44Role === 'admin';
  const isOwnerAdmin = businessRole === 'owner_admin';

  console.log('hostawaySync user keys:', Object.keys(user));
  console.log('hostawaySync roles:', { base44Role, businessRole, business_id: readUserField('business_id') });

  if (!isAdmin && !isOwnerAdmin) {
    return Response.json({
      error: `Access denied. Base44 role: "${base44Role || 'unknown'}". Business role: "${businessRole || 'unknown'}". Hostaway settings require system admin or owner_admin.`
    }, { status: 403 });
  }

  const userBusinessId = readUserField('business_id');

  const payload = await req.json();
  const { action, account_id, api_key, start_date, end_date, status_filter } = payload;
  const submittedBusinessId = payload.business_id || '';

  console.log(`hostawaySync [${action}] | base44Role=${base44Role} | businessRole=${businessRole} | userBusinessId=${userBusinessId} | submittedBusinessId=${submittedBusinessId}`);

  if (!action) return Response.json({ error: 'action required' }, { status: 400 });

  // For owner_admin: enforce that submitted business_id matches the user's own business_id
  if (isOwnerAdmin) {
    if (!userBusinessId) {
      return Response.json({ error: 'Missing business ID: your user account is not linked to a business. Contact your admin.' }, { status: 403 });
    }
    if (submittedBusinessId && submittedBusinessId !== userBusinessId) {
      return Response.json({ error: `Access denied: your user is not linked to this business. Your business: "${userBusinessId}", submitted: "${submittedBusinessId}"` }, { status: 403 });
    }
  }

  // Always derive business_id server-side from the authenticated user (admin can override)
  const business_id = isAdmin ? (submittedBusinessId || userBusinessId) : userBusinessId;

  // ── Get Setting (safe — strips access_token before returning to client) ────────
  if (action === 'get_setting') {
    const rows = await base44.asServiceRole.entities.HostawayApiSetting.filter({ business_id });
    const s = rows[0];
    if (!s) return Response.json({ success: true, setting: null });
    // Never return access_token to the client
    const { access_token: _stripped, ...safeSetting } = s;
    safeSetting.has_valid_token = !!(s.access_token && s.token_expires_at && new Date(s.token_expires_at) > new Date());
    return Response.json({ success: true, setting: safeSetting });
  }

  // ── Get / Refresh Token ──────────────────────────────────────────────────────
  if (action === 'get_token') {
    if (!account_id || !api_key) return Response.json({ error: 'account_id and api_key required' }, { status: 400 });
    const { access_token, expires_in } = await getAccessToken(account_id, api_key);
    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    // Save to HostawayApiSetting using service role — token never travels back to client
    const existing = await base44.asServiceRole.entities.HostawayApiSetting.filter({ business_id });
    const settingData = {
      business_id,
      hostaway_account_id: account_id,
      hostaway_api_key_hint: api_key.slice(-4),
      access_token,
      token_expires_at: expiresAt,
      connection_status: 'Connected',
      last_token_refresh_at: new Date().toISOString(),
      last_error_message: '',
    };
    if (existing.length > 0) {
      await base44.asServiceRole.entities.HostawayApiSetting.update(existing[0].id, settingData);
    } else {
      await base44.asServiceRole.entities.HostawayApiSetting.create(settingData);
    }
    // Return only metadata — never the token itself
    return Response.json({ success: true, expires_at: expiresAt });
  }

  // ── Save Credentials (without fetching token yet) ────────────────────────────
  if (action === 'save_credentials') {
    if (!account_id || !api_key) return Response.json({ error: 'account_id and api_key required' }, { status: 400 });
    const existing = await base44.asServiceRole.entities.HostawayApiSetting.filter({ business_id });
    const settingData = {
      business_id,
      hostaway_account_id: account_id,
      hostaway_api_key_hint: api_key.slice(-4),
      connection_status: 'Not Configured',
    };
    if (existing.length > 0) {
      await base44.asServiceRole.entities.HostawayApiSetting.update(existing[0].id, settingData);
    } else {
      await base44.asServiceRole.entities.HostawayApiSetting.create(settingData);
    }
    return Response.json({ success: true });
  }

  // ── For all other actions, need an existing token ────────────────────────────
  // Use asServiceRole to read the token server-side only — never expose it to the client
  const settings = await base44.asServiceRole.entities.HostawayApiSetting.filter({ business_id });
  const setting = settings[0];
  if (!setting?.access_token) return Response.json({ error: 'No access token. Please get/refresh token first.' }, { status: 400 });
  const token = setting.access_token;

  // ── Test Connection ──────────────────────────────────────────────────────────
  if (action === 'test_connection') {
    const rows = await fetchReservations(token, { limit: '1' });
    await base44.asServiceRole.entities.HostawayApiSetting.update(setting.id, {
      connection_status: 'Connected',
      last_test_connection_at: new Date().toISOString(),
      last_error_message: '',
    });
    return Response.json({ success: true, message: `Connection OK. Got ${rows.length} reservation(s).` });
  }

  // ── Test Small Reservation Pull ──────────────────────────────────────────────
  if (action === 'test_reservations') {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 60);
    const rows = await fetchReservations(token, { limit: '5', sortOrder: 'desc', departureStartDate: recentDate.toISOString().split('T')[0] });
    const mapped = rows.map(r => mapReservation(r, business_id));
    return Response.json({ success: true, raw: rows, mapped });
  }

  // ── Test Small Task Pull ──────────────────────────────────────────────────────
  if (action === 'test_tasks') {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 60);
    const rows = await fetchTasks(token, { limit: '5', sortOrder: 'desc', shouldEndByFrom: recentDate.toISOString().split('T')[0] });
    const mapped = rows.map(t => mapTask(t, business_id));
    const debug_assignee_fields = rows[0] ? Object.entries(rows[0])
      .filter(([k]) => /assign|user|name/i.test(k))
      .reduce((a, [k, v]) => { a[k] = v; return a; }, {}) : {};
    return Response.json({ success: true, raw: rows, mapped, debug_assignee_fields });
  }

  // ── Fetch Hostaway Users ─────────────────────────────────────────────────────
  if (action === 'fetch_users') {
    const users = await fetchUsers(token);
    return Response.json({
      success: true,
      users: users.map(u => ({
        id: String(u.id || ''),
        name: u.name || u.fullName || `${u.firstName || ''} ${u.lastName || ''}`.trim(),
        email: u.email || '',
        role: u.role || u.userType || '',
      })),
    });
  }

  // ── Full Reservation Sync ────────────────────────────────────────────────────
  if (action === 'sync_reservations') {
    if (!start_date || !end_date) return Response.json({ error: 'start_date and end_date required' }, { status: 400 });

    // Add 7-day buffer
    const sd = new Date(start_date);
    const ed = new Date(end_date);
    sd.setDate(sd.getDate() - 7);
    ed.setDate(ed.getDate() + 7);
    const params = {
      departureStartDate: sd.toISOString().split('T')[0],
      departureEndDate: ed.toISOString().split('T')[0],
      limit: '100',
    };

    let rows = await fetchReservations(token, params);

    // If status_filter = 'new_modified', only keep New and Modified reservations
    if (status_filter === 'new_modified') {
      rows = rows.filter(r => {
        const s = (r.status || '').toLowerCase();
        return s === 'new' || s === 'modified' || s === 'confirmed' || s === 'inquiry';
      });
    }

    const mapped = rows.map(r => mapReservation(r, business_id));

    // Upsert — load only existing records in the date window (scoped by source_type=API to keep set small)
    const existing = await base44.asServiceRole.entities.Reservation.filter({ business_id, source_type: 'API' });
    const existingByResId = {};
    existing.forEach(r => { existingByResId[r.reservation_id] = r; });

    const toCreate = [], toUpdate = [];
    for (const rec of mapped) {
      const ex = existingByResId[rec.reservation_id];
      if (!ex) {
        toCreate.push(rec);
      } else {
        // Only update API-controlled fields — do not overwrite user-managed fields
        toUpdate.push({
          id: ex.id,
          data: {
            guest_name: rec.guest_name,
            check_in_date: rec.check_in_date,
            check_out_date: rec.check_out_date,
            reservation_created_date: rec.reservation_created_date,
            reservation_date: rec.reservation_date,
            cleaning_fee_value: rec.cleaning_fee_value,
            pet_fee_value: rec.pet_fee_value,
            channel: rec.channel,
            status: rec.status,
            confirmation_code: rec.confirmation_code,
            normalized_reservation_key: rec.normalized_reservation_key,
            hostaway_reservation_id: rec.hostaway_reservation_id,
            external_reservation_id: rec.external_reservation_id,
            channel_reservation_id: rec.channel_reservation_id,
            listing_name: rec.listing_name,
            hostaway_listing_id: rec.hostaway_listing_id,
            reservation_fees_raw_json: rec.reservation_fees_raw_json,
            api_raw_json: rec.api_raw_json,
            api_last_synced_at: rec.api_last_synced_at,
            import_status: 'Synced',
            source_type: 'API',
          },
        });
      }
    }

    await bulkUpsert(base44.asServiceRole.entities.Reservation, toCreate, toUpdate);

    await base44.asServiceRole.entities.HostawayApiSetting.update(setting.id, {
      last_reservation_sync_at: new Date().toISOString(),
      last_error_message: '',
    });

    return Response.json({
      success: true,
      created: toCreate.length,
      updated: toUpdate.length,
      total: mapped.length,
      reservations: mapped.map(r => ({ check_in_date: r.check_in_date, check_out_date: r.check_out_date })),
    });
  }

  // ── Full Task Sync ───────────────────────────────────────────────────────────
  if (action === 'sync_tasks') {
    if (!start_date || !end_date) return Response.json({ error: 'start_date and end_date required' }, { status: 400 });

    const sd = new Date(start_date);
    const ed = new Date(end_date);
    sd.setDate(sd.getDate() - 7);
    ed.setDate(ed.getDate() + 7);
    const params = {
      shouldEndByFrom: sd.toISOString().split('T')[0],
      shouldEndByTo: ed.toISOString().split('T')[0],
      limit: '100',
    };

    const rows = await fetchTasks(token, params);

    // Load reservations to normalize keys; load cleaners & mappings for assignment
    const [reservations, cleaners, mappings] = await Promise.all([
      base44.asServiceRole.entities.Reservation.filter({ business_id }),
      base44.asServiceRole.entities.Cleaner.list('cleaner_name', 200),
      base44.asServiceRole.entities.HostawayUserCleanerMapping.filter({ business_id }),
    ]);

    const resByResId = {};
    reservations.forEach(r => {
      if (r.reservation_id) resByResId[r.reservation_id] = r;
      if (r.hostaway_reservation_id) resByResId[r.hostaway_reservation_id] = r;
    });

    const cleanerByEmail = {};
    const cleanerByName = {};
    cleaners.forEach(c => {
      if (c.email) cleanerByEmail[c.email.trim().toLowerCase()] = c;
      if (c.cleaner_name) cleanerByName[c.cleaner_name.trim().toLowerCase()] = c;
    });

    const mappingByUserId = {};
    mappings.forEach(m => { if (m.hostaway_user_id) mappingByUserId[m.hostaway_user_id] = m; });

    const mapped = rows.map(t => {
      const rec = mapTask(t, business_id);
      const matchedRes = resByResId[rec.reservation_id];
      if (matchedRes) {
        rec.normalized_reservation_key = matchedRes.normalized_reservation_key;
        rec.listing_name = matchedRes.listing_name;
        rec.matched_reservation_id = matchedRes.id;
      }

      // Try to resolve cleaner from user mapping
      const userMapping = mappingByUserId[rec.assignee_user_id];
      if (userMapping?.cleaner_id) {
        const c = cleaners.find(cl => cl.id === userMapping.cleaner_id);
        if (c) {
          rec.cleaner_id = c.id;
          rec.cleaner_name = c.cleaner_name;
          rec.cleaner_code = c.cleaner_code;
          rec.assignee_user = c.cleaner_name;
        }
      } else if (rec.assignee_user_id) {
        rec.import_status = 'Needs Mapping';
        rec.import_exception_reason = 'Hostaway User Not Mapped To Cleaner';
      }

      return rec;
    });

    // Upsert — scope to API-sourced tasks to keep the lookup set small
    const existingTasks = await base44.asServiceRole.entities.CleaningTask.filter({ business_id, source_type: 'API' });
    const existingByTaskId = {};
    existingTasks.forEach(t => { existingByTaskId[t.task_id] = t; });

    const toCreate = [], toUpdate = [];
    for (const rec of mapped) {
      const ex = existingByTaskId[rec.task_id];
      if (!ex) {
        toCreate.push(rec);
      } else {
        toUpdate.push({
          id: ex.id,
          data: {
            task_title: rec.task_title,
            description: rec.description,
            status: rec.status,
            reservation_id: rec.reservation_id,
            normalized_reservation_key: rec.normalized_reservation_key,
            hostaway_listing_id: rec.hostaway_listing_id,
            listing_name: rec.listing_name,
            assignee_user_id: rec.assignee_user_id,
            assignee_user: rec.assignee_user,
            supervisor_user_id: rec.supervisor_user_id,
            can_start_from: rec.can_start_from,
            started_at: rec.started_at,
            should_end_by: rec.should_end_by,
            completed_at: rec.completed_at,
            confirmed_at: rec.confirmed_at,
            cost: rec.cost,
            cost_currency: rec.cost_currency,
            cost_description: rec.cost_description,
            categories: rec.categories,
            cleaner_id: rec.cleaner_id || ex.cleaner_id,
            cleaner_name: rec.cleaner_name || ex.cleaner_name,
            cleaner_code: rec.cleaner_code || ex.cleaner_code,
            matched_reservation_id: rec.matched_reservation_id || ex.matched_reservation_id,
            api_raw_json: rec.api_raw_json,
            api_last_synced_at: rec.api_last_synced_at,
            import_status: rec.import_status,
            import_exception_reason: rec.import_exception_reason || '',
            source_type: 'API',
          },
        });
      }
    }

    await bulkUpsert(base44.asServiceRole.entities.CleaningTask, toCreate, toUpdate);

    await base44.asServiceRole.entities.HostawayApiSetting.update(setting.id, {
      last_task_sync_at: new Date().toISOString(),
      last_error_message: '',
    });

    return Response.json({ success: true, created: toCreate.length, updated: toUpdate.length, total: mapped.length });
  }

  // ── Fetch Hostaway Listings ──────────────────────────────────────────────────
  if (action === 'fetch_listings') {
    const res = await fetch('https://api.hostaway.com/v1/listings?includeResources=1&limit=100', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: `Listings fetch failed ${res.status}: ${text}` }, { status: 500 });
    }
    const data = await res.json();
    const listings = data.result || data.data || [];
    return Response.json({
      success: true,
      listings: listings.map(l => ({
        hostaway_listing_id: String(l.id || ''),
        listing_name: l.name || l.internalListingName || '',
        qbo_class_name: l.name || l.internalListingName || '',
        owner_name: l.ownerName || (l.owner && (l.owner.name || l.owner.fullName)) || '',
        owner_id: String(l.ownerId || (l.owner && l.owner.id) || ''),
        notes: l.description || '',
      })),
    });
  }

  return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error('hostawaySync error:', err);
    return Response.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
});