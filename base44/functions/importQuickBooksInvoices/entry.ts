import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// SECURITY: Centralized read-only QBO request function.
// Never call fetch() directly for a QBO URL elsewhere in this function.
async function readOnlyQboFetch(url, options = {}) {
  const method = String(options.method ?? "GET").toUpperCase();

  if (method !== "GET") {
    throw new Error(`SECURITY_BLOCK: QBO ${method} requests are prohibited.`);
  }

  if (options.body !== undefined && options.body !== null) {
    throw new Error("SECURITY_BLOCK: QBO request bodies are prohibited.");
  }

  const parsedUrl = new URL(url);

  const allowedHosts = new Set([
    "quickbooks.api.intuit.com",
    "sandbox-quickbooks.api.intuit.com",
  ]);

  if (
    parsedUrl.protocol !== "https:" ||
    !allowedHosts.has(parsedUrl.hostname)
  ) {
    throw new Error("SECURITY_BLOCK: Invalid QBO API destination.");
  }

  // SECURITY: This integration only permits QBO query endpoints.
  if (!/^\/v3\/company\/[^/]+\/query$/.test(parsedUrl.pathname)) {
    throw new Error("SECURITY_BLOCK: Unauthorized QBO API endpoint.");
  }

  return fetch(parsedUrl.toString(), {
    ...options,
    method: "GET",
    body: undefined,
  });
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCustomerName(raw) {
  const customerName = raw ?? "";
  const parts = customerName.split(" - ");
  const channel = parts[0]?.trim() || null;
  const guestName = parts[1]?.trim() || null;
  const confirmationCode =
    parts.length >= 3 ? parts.slice(2).join(" - ").trim() : null;
  const baseConfirmationCode = confirmationCode
    ? confirmationCode.replace(/-[0-9]+$/, "")
    : null;
  return { channel, guestName, confirmationCode, baseConfirmationCode };
}

async function fetchInvoicePage(baseUrl, realmId, accessToken, query) {
  const encoded = encodeURIComponent(query);
  const url = `${baseUrl}/v3/company/${realmId}/query?query=${encoded}`;
  const res = await readOnlyQboFetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (res.status === 401) {
    throw new Error("QBO_UNAUTHORIZED: Access token is expired or invalid.");
  }
  if (res.status === 429) {
    throw new Error("QBO_RATE_LIMIT: QuickBooks rate limit reached. Try again shortly.");
  }
  if (!res.ok) {
    // SECURITY: Do not log the QBO response body. It may contain
    // customer names, addresses, invoice information, or other data.
    console.error(`QBO request failed with HTTP ${res.status}`);
    throw new Error("QBO_HTTP_ERROR");
  }

  return res.json();
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000);
}

async function fetchAllInvoices(baseUrl, realmId, accessToken, startDate, endDate) {
  const allInvoices = [];
  let startPosition = 1;
  let pageCount = 0;

  const MAX_PAGES = 100;
  const MAX_INVOICES = 100_000;

  while (true) {
    pageCount++;

    if (pageCount > MAX_PAGES) {
      throw new Error("QBO_SAFETY_LIMIT: Maximum page count exceeded.");
    }

    const query =
      `SELECT * FROM Invoice ` +
      `WHERE TxnDate >= '${startDate}' ` +
      `AND TxnDate <= '${endDate}' ` +
      `ORDERBY TxnDate ` +
      `STARTPOSITION ${startPosition} MAXRESULTS 1000`;

    const data = await fetchInvoicePage(
      baseUrl,
      realmId,
      accessToken,
      query
    );

    const invoices = data?.QueryResponse?.Invoice ?? [];

    if (!Array.isArray(invoices)) {
      throw new Error("QBO_INVALID_RESPONSE");
    }

    allInvoices.push(...invoices);

    if (allInvoices.length > MAX_INVOICES) {
      throw new Error("QBO_SAFETY_LIMIT: Maximum invoice count exceeded.");
    }

    console.log(
      `Fetched invoice page ${pageCount}; records=${invoices.length}`
    );

    if (invoices.length < 1000) break;

    startPosition += 1000;
  }

  return allInvoices;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") {
      return Response.json({ error: "Forbidden: Admin access required." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { startDate, endDate } = body;

    if (!startDate || !endDate) {
      return Response.json({ error: "startDate and endDate are required (YYYY-MM-DD)." }, { status: 400 });
    }
    if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
      return Response.json(
        { error: "Invalid date. Use a real calendar date in YYYY-MM-DD format." },
        { status: 400 }
    );
}

    const requestedDays = daysBetween(startDate, endDate);

    if (requestedDays > 366) {
      return Response.json(
        { error: "The import range cannot exceed 366 days." },
        { status: 400 }
      );
    }

    if (startDate > endDate) {
      return Response.json({ error: "startDate must be before or equal to endDate." }, { status: 400 });
    }

    const accessToken = Deno.env.get("QBO_ACCESS_TOKEN");
    const realmId = Deno.env.get("QBO_REALM_ID");
    const environment = Deno.env.get("QBO_ENVIRONMENT");

    if (!["sandbox", "production"].includes(environment)) {
      console.error("QBO_ENVIRONMENT is missing or invalid.");
      return Response.json(
        { error: "QuickBooks environment is not configured correctly." },
        { status: 500 }
      );
    }

    if (!accessToken || !realmId) {
      return Response.json({ error: "QuickBooks credentials are not configured." }, { status: 500 });
    }

    const baseUrl =
      environment === "production"
        ? "https://quickbooks.api.intuit.com"
        : "https://sandbox-quickbooks.api.intuit.com";

    const maskedRealm =
      realmId.length > 4 ? `***${realmId.slice(-4)}` : "***";

    console.log(
      `QBO import started: env=${environment}, realm=${maskedRealm}, ` +
      `range=${startDate}–${endDate}`
    );

    // Fetch all invoices
    let invoices;
    try {
      invoices = await fetchAllInvoices(baseUrl, realmId, accessToken, startDate, endDate);
    } catch (err) {
      if (err.message.startsWith("QBO_UNAUTHORIZED")) {
        return Response.json({ error: "QuickBooks access token is expired or invalid. Please refresh the token." }, { status: 401 });
      }
      if (err.message.startsWith("QBO_RATE_LIMIT")) {
        return Response.json({ error: "QuickBooks rate limit reached. Please wait a moment and try again." }, { status: 429 });
      }
      return Response.json({ error: "Failed to fetch invoices from QuickBooks. Check server logs for details." }, { status: 502 });
    }

    // Stats
    const stats = {
      invoices_received: invoices.length,
      invoice_lines_reviewed: 0,
      pet_fee_lines_found: 0,
      cleaning_fee_lines_found: 0,
      records_created: 0,
      records_updated: 0,
      records_skipped: 0,
      errors: 0,
    };

    const ITEM_REF_PET_FEE = "13";
    const ITEM_REF_CLEANING_FEE = "3";
    const now = new Date().toISOString();

    for (const invoice of invoices) {
      const lines = invoice.Line ?? [];
      const { channel, guestName, confirmationCode, baseConfirmationCode } =
        parseCustomerName(invoice.CustomerRef?.name ?? "");

      for (const line of lines) {
        stats.invoice_lines_reviewed++;

        // Only process SalesItemLineDetail lines with a valid ItemRef
        if (line.DetailType !== "SalesItemLineDetail") continue;
        const detail = line.SalesItemLineDetail;
        if (!detail?.ItemRef) continue;

        const itemRefValue = detail.ItemRef.value;
        if (itemRefValue !== ITEM_REF_PET_FEE && itemRefValue !== ITEM_REF_CLEANING_FEE) continue;

        const feeType = itemRefValue === ITEM_REF_PET_FEE ? "pet_fee" : "cleaning_fee";
        if (feeType === "pet_fee") stats.pet_fee_lines_found++;
        else stats.cleaning_fee_lines_found++;

        const record = {
          qbo_invoice_id: String(invoice.Id),
          qbo_line_id: String(line.Id),
          line_number: line.LineNum ?? null,
          doc_number: invoice.DocNumber ?? null,
          invoice_date: invoice.TxnDate ?? null,
          due_date: invoice.DueDate ?? null,
          customer_id: invoice.CustomerRef?.value ?? null,
          customer_name: invoice.CustomerRef?.name ?? null,
          channel,
          guest_name: guestName,
          confirmation_code: confirmationCode,
          base_confirmation_code: baseConfirmationCode,
          fee_type: feeType,
          item_ref: itemRefValue,
          item_name: detail.ItemRef.name ?? null,
          description: line.Description ?? null,
          quantity: detail.Qty ?? null,
          unit_price: detail.UnitPrice ?? null,
          line_amount: line.Amount ?? 0,
          invoice_total: invoice.TotalAmt ?? null,
          invoice_balance: invoice.Balance ?? null,
          realm_id: realmId,
          qbo_create_time: invoice.MetaData?.CreateTime ?? null,
          qbo_last_updated_time: invoice.MetaData?.LastUpdatedTime ?? null,
          last_synced_at: now,
        };

        try {
          // Look up existing record by realm_id + qbo_invoice_id + qbo_line_id
          const existing = await base44.asServiceRole.entities.QuickBooksInvoiceLine.filter({
            realm_id: realmId,
            qbo_invoice_id: String(invoice.Id),
            qbo_line_id: String(line.Id),
          });

          if (existing && existing.length > 0) {
            await base44.asServiceRole.entities.QuickBooksInvoiceLine.update(
              existing[0].id,
              record
            );
            stats.records_updated++;
          } else {
            await base44.asServiceRole.entities.QuickBooksInvoiceLine.create({
              ...record,
              imported_at: now,
            });
            stats.records_created++;
          }
        } catch (lineErr) {
          console.error(
            `Error saving line inv=${invoice.Id} line=${line.Id}:`,
            lineErr.message
          );
          stats.errors++;
        }
      }
    }

    console.log("QBO import complete:", JSON.stringify(stats));
    return Response.json({ success: true, stats });
  } catch (err) {
    console.error("importQuickBooksInvoices fatal error:", err.message);
    return Response.json(
      { error: "An unexpected error occurred during the import. Check server logs." },
      { status: 500 }
    );
  }
});