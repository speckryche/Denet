import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/utils.ts';

interface CommissionRequest {
  month: string;
  year: number;
}

interface ATMData {
  atm_id: string;
  total_sales: number;
  total_fees: number;
  bitstop_fees: number;
  rent: number;
  cash_management_rps: number;
  cash_management_rep: number;
  sales_rep_id: string | null;
}

interface CommissionResult {
  sales_rep_id: string;
  atm_id: string;
  total_fees: number;
  bitstop_fees: number;
  rent: number;
  cash_management_rps: number;
  cash_management_rep: number;
  net_profit: number;
  commission_amount: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
      status: 200,
    });
  }

  try {
    const { month, year } = (await req.json()) as CommissionRequest;

    if (!month || !year) {
      return new Response(
        JSON.stringify({ error: 'Month and year are required' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    const startDate = new Date(year, parseInt(month) - 1, 1);
    const endDate = new Date(year, parseInt(month), 0);

    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('atm_id, fee, bitstop_fee, sale, date')
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0]);

    if (txError) throw txError;

    console.log('Sample transaction:', transactions?.[0]);
    console.log('Total transactions fetched:', transactions?.length);

    if (!transactions || transactions.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: `No transaction data found for ${month}/${year}. Please upload transaction data for this period first.` 
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    // Fetch ALL ATM profiles (including historical ones with date ranges)
    const { data: atmProfiles, error: atmError } = await supabase
      .from('atm_profiles')
      .select('id, atm_id, sales_rep_id, monthly_rent, cash_management_rps, cash_management_rep, installed_date, removed_date, location_name');

    if (atmError) throw atmError;

    const { data: salesReps, error: repError } = await supabase
      .from('sales_reps')
      .select('id, name, commission_percentage, flat_monthly_fee');

    if (repError) throw repError;

    // Helper function to find the correct ATM profile for a given transaction date
    const findATMProfile = (atmId: string, transactionDate: Date) => {
      const profiles = atmProfiles?.filter(p => p.atm_id === atmId) || [];

      for (const profile of profiles) {
        const installDate = profile.installed_date ? new Date(profile.installed_date) : null;
        const removalDate = profile.removed_date ? new Date(profile.removed_date) : null;

        // Check if transaction date falls within this profile's date range
        const afterInstall = !installDate || transactionDate >= installDate;
        const beforeRemoval = !removalDate || transactionDate <= removalDate;

        if (afterInstall && beforeRemoval) {
          return profile;
        }
      }

      // If no profile found with date range, return first profile (fallback for legacy data)
      return profiles[0] || null;
    };

    // Helper function to calculate expense months for the commission month
    const calculateExpenseMonths = (profile: any, monthStartDate: Date, monthEndDate: Date): number => {
      const installDate = profile.installed_date ? new Date(profile.installed_date) : null;
      const removalDate = profile.removed_date ? new Date(profile.removed_date) : null;

      // Determine the effective start and end dates for this profile
      // Install date: first full month starts the FOLLOWING calendar month
      let effectiveStart = monthStartDate;
      if (installDate) {
        // Get the first day of the month AFTER install date
        const monthAfterInstall = new Date(installDate.getFullYear(), installDate.getMonth() + 1, 1);
        if (monthAfterInstall > effectiveStart) {
          effectiveStart = monthAfterInstall;
        }
      }

      // Removal date: last full month is the month of removal
      let effectiveEnd = monthEndDate;
      if (removalDate && removalDate < effectiveEnd) {
        effectiveEnd = removalDate;
      }

      // If effective start is after effective end, no expense months
      if (effectiveStart > effectiveEnd) {
        return 0;
      }

      // For a single month commission calculation, return 1 if the profile is active in this month, 0 otherwise
      if (effectiveStart <= monthEndDate && effectiveEnd >= monthStartDate) {
        return 1;
      }

      return 0;
    };

    const repMap = new Map(salesReps?.map(r => [r.id, r]) || []);

    // Find Steven Kraft's ID - he gets paid for ALL ATMs, not just ones with sales
    const stevenKraft = salesReps?.find(r => r.name === 'Steven Kraft');
    const stevenKraftId = stevenKraft?.id || null;

    // Aggregate by ATM ID + Location (to handle same ATM at different locations)
    // Use composite key: atm_id|location_name
    const atmAggregates = new Map<string, ATMData & { location_name: string }>();

    transactions?.forEach((tx: any) => {
      if (!tx.atm_id) return;

      // Find the correct profile for this transaction's date
      const txDate = new Date(tx.date);
      const matchingProfile = findATMProfile(tx.atm_id, txDate);

      if (!matchingProfile) {
        console.warn(`No profile found for ATM ${tx.atm_id} on ${tx.date}`);
        return;
      }

      // Create a composite key: atm_id|location_name to handle same ATM at different locations
      const compositeKey = `${tx.atm_id}|${matchingProfile.location_name || 'Unknown'}`;

      if (!atmAggregates.has(compositeKey)) {
        // Calculate if this profile has expenses for this month
        const expenseMonths = calculateExpenseMonths(matchingProfile, startDate, endDate);

        atmAggregates.set(compositeKey, {
          atm_id: tx.atm_id,
          location_name: matchingProfile.location_name || tx.atm_id,
          total_sales: 0,
          total_fees: 0,
          bitstop_fees: 0,
          rent: expenseMonths > 0 ? (matchingProfile.monthly_rent || 0) : 0,
          cash_management_rps: expenseMonths > 0 ? (matchingProfile.cash_management_rps || 0) : 0,
          cash_management_rep: expenseMonths > 0 ? (matchingProfile.cash_management_rep || 0) : 0,
          sales_rep_id: matchingProfile.sales_rep_id || null,
        });
      }

      const data = atmAggregates.get(compositeKey)!;
      data.total_sales += Number(tx.sale) || 0;
      data.total_fees += Number(tx.fee) || 0;
      data.bitstop_fees += Number(tx.bitstop_fee) || 0;

      if (tx.bitstop_fee) {
        console.log(`ATM ${tx.atm_id} has bitstop_fee: ${tx.bitstop_fee}, type: ${typeof tx.bitstop_fee}`);
      }
    });

    // Special handling for Steven Kraft: Include ALL his ATMs, not just ones with sales
    // He gets paid the cash_management_rep fee for every ATM he manages
    if (stevenKraftId) {
      const stevenATMs = atmProfiles?.filter(p => p.sales_rep_id === stevenKraftId) || [];

      for (const profile of stevenATMs) {
        if (!profile.atm_id) continue;

        // Check if this ATM was already included (had sales)
        const compositeKey = `${profile.atm_id}|${profile.location_name || 'Unknown'}`;

        if (!atmAggregates.has(compositeKey)) {
          // This ATM had no sales - add it with $0 sales but include the CM Rep fee
          const expenseMonths = calculateExpenseMonths(profile, startDate, endDate);

          if (expenseMonths > 0) {
            atmAggregates.set(compositeKey, {
              atm_id: profile.atm_id,
              location_name: profile.location_name || profile.atm_id,
              total_sales: 0,
              total_fees: 0,
              bitstop_fees: 0,
              rent: profile.monthly_rent || 0,
              cash_management_rps: profile.cash_management_rps || 0,
              cash_management_rep: profile.cash_management_rep || 0,
              sales_rep_id: stevenKraftId,
            });
            console.log(`Added Steven Kraft ATM without sales: ${profile.atm_id} (${profile.location_name}), CM Rep: $${profile.cash_management_rep}`);
          }
        }
      }
    }

    const commissionDetails: CommissionResult[] = [];
    const commissionsByRep = new Map<string, any>();

    atmAggregates.forEach((atmData) => {
      if (!atmData.sales_rep_id) return;

      const netProfit =
        atmData.total_fees -
        atmData.bitstop_fees -
        atmData.rent -
        atmData.cash_management_rps -
        atmData.cash_management_rep;

      const rep = repMap.get(atmData.sales_rep_id);
      if (!rep) return;

      // Don't calculate commission per ATM yet - we'll do it based on total net profit
      // Store commissionAmount as 0 for now, will be calculated later
      const commissionAmount = 0;

      commissionDetails.push({
        sales_rep_id: atmData.sales_rep_id,
        atm_id: atmData.atm_id,
        total_sales: atmData.total_sales,
        total_fees: atmData.total_fees,
        bitstop_fees: atmData.bitstop_fees,
        rent: atmData.rent,
        cash_management_rps: atmData.cash_management_rps,
        cash_management_rep: atmData.cash_management_rep,
        net_profit: netProfit,
        commission_amount: commissionAmount,
      });

      if (!commissionsByRep.has(atmData.sales_rep_id)) {
        commissionsByRep.set(atmData.sales_rep_id, {
          sales_rep_id: atmData.sales_rep_id,
          total_sales: 0,
          total_fees: 0,
          bitstop_fees: 0,
          rent: 0,
          mgmt_rps: 0,
          mgmt_rep: 0,
          total_net_profit: 0,
          commission_amount: 0,
          flat_fee_amount: 0,
          atm_count: 0,
          commission_percentage: rep.commission_percentage,
        });
      }

      const repData = commissionsByRep.get(atmData.sales_rep_id);
      repData.total_sales += atmData.total_sales;
      repData.total_fees += atmData.total_fees;
      repData.bitstop_fees += atmData.bitstop_fees;

      console.log(`ATM ${atmData.atm_id} bitstop_fees: ${atmData.bitstop_fees}, running total: ${repData.bitstop_fees}`);

      repData.rent += atmData.rent;
      repData.mgmt_rps += atmData.cash_management_rps;
      repData.mgmt_rep += atmData.cash_management_rep;
      repData.total_net_profit += netProfit;
      // Don't add commission here anymore
      repData.atm_count += 1;

      // For Steven Kraft, flat fee is the sum of cash_management_rep from all his ATMs
      // For other reps, use atm_count * flat_monthly_fee
      if (atmData.sales_rep_id === stevenKraftId) {
        repData.flat_fee_amount += atmData.cash_management_rep;
      } else {
        repData.flat_fee_amount = repData.atm_count * rep.flat_monthly_fee;
      }
    });

    // Now calculate commission based on total net profit per rep
    commissionsByRep.forEach((repData) => {
      const totalCommission = repData.total_net_profit > 0
        ? (repData.total_net_profit * repData.commission_percentage) / 100
        : 0;
      repData.commission_amount = totalCommission;

      // Update commission details - distribute proportionally across ALL ATMs (including unprofitable)
      commissionDetails.forEach((detail) => {
        if (detail.sales_rep_id === repData.sales_rep_id) {
          // Calculate this ATM's proportion of the total commission (can be negative)
          if (repData.total_net_profit !== 0) {
            detail.commission_amount = (detail.net_profit / repData.total_net_profit) * totalCommission;
          } else {
            detail.commission_amount = 0;
          }
        }
      });
    });

    // Format month_year as YYYY-MM-01 to avoid timezone issues
    const monthPadded = month.padStart(2, '0');
    const monthYearString = `${year}-${monthPadded}-01`;

    const commissionsToInsert = Array.from(commissionsByRep.values()).map((data) => ({
      sales_rep_id: data.sales_rep_id,
      month_year: monthYearString,
      total_sales: data.total_sales,
      total_fees: data.total_fees,
      bitstop_fees: data.bitstop_fees,
      rent: data.rent,
      mgmt_rps: data.mgmt_rps,
      mgmt_rep: data.mgmt_rep,
      total_net_profit: data.total_net_profit,
      commission_amount: data.commission_amount,
      flat_fee_amount: data.flat_fee_amount,
      total_commission: data.commission_amount + data.flat_fee_amount,
      atm_count: data.atm_count,
      paid: false,
    }));

    if (commissionsToInsert.length > 0) {
      const { data: insertedCommissions, error: insertError } = await supabase
        .from('commissions')
        .upsert(commissionsToInsert, { onConflict: 'sales_rep_id,month_year' })
        .select();

      if (insertError) throw insertError;

      // Delete existing details for this month/year before inserting new ones
      if (insertedCommissions && insertedCommissions.length > 0) {
        const commissionIds = insertedCommissions.map((c) => c.id);
        
        await supabase
          .from('commission_details')
          .delete()
          .in('commission_id', commissionIds);

        // Group details by sales rep
        const detailsByRep = new Map<string, CommissionResult[]>();
        commissionDetails.forEach((detail) => {
          if (!detailsByRep.has(detail.sales_rep_id)) {
            detailsByRep.set(detail.sales_rep_id, []);
          }
          detailsByRep.get(detail.sales_rep_id)!.push(detail);
        });

        // Insert details with correct commission_id for each rep
        for (const commission of insertedCommissions) {
          const repDetails = detailsByRep.get(commission.sales_rep_id);
          if (repDetails && repDetails.length > 0) {
            const detailsToInsert = repDetails.map((detail) => ({
              commission_id: commission.id,
              atm_id: detail.atm_id,
              total_sales: detail.total_sales,
              total_fees: detail.total_fees,
              bitstop_fees: detail.bitstop_fees,
              rent: detail.rent,
              cash_fee: detail.cash_management_rps + detail.cash_management_rep,
              cash_management_rps: detail.cash_management_rps,
              cash_management_rep: detail.cash_management_rep,
              net_profit: detail.net_profit,
              commission_amount: detail.commission_amount,
            }));

            const { error: detailError } = await supabase
              .from('commission_details')
              .insert(detailsToInsert);

            if (detailError) throw detailError;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Commissions calculated for ${month}/${year}`,
        commissionsCreated: commissionsToInsert.length,
        details: commissionDetails,
        debug: {
          commissionsData: Array.from(commissionsByRep.values()).map(d => ({
            sales_rep_id: d.sales_rep_id,
            bitstop_fees: d.bitstop_fees,
            total_fees: d.total_fees
          })),
          sampleTransaction: transactions?.[0]
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error calculating commissions:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
