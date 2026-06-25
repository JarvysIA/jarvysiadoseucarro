import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sanitizePlate } from "@/lib/plate";

export type ArchivedLookup = {
  found: false;
} | {
  found: true;
  vehicle: {
    id: string;
    placa: string;
    marca: string | null;
    modelo: string | null;
    ano: string | null;
    cor: string | null;
    chassi: string | null;
    km_atual: number | null;
    foto_url: string | null;
  };
};

/**
 * Procura um veículo arquivado pela mesma placa (status='archived', user_id IS NULL)
 * e, se encontrar, faz o "claim" (resgate) atribuindo ao usuário logado e marcando
 * history_locked = true + claimed_at = now(). Retorna os dados do veículo resgatado
 * para o front renderizar imediatamente. Se nada for encontrado, retorna { found:false }
 * e o front cria um veículo novo do zero.
 */
export const claimArchivedVehicleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { placa: string }) => {
    const placa = sanitizePlate(data?.placa ?? "");
    if (!placa) throw new Error("Placa obrigatória.");
    return { placa };
  })
  .handler(async ({ data, context }): Promise<ArchivedLookup> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: archived, error } = await supabaseAdmin
      .from("veiculos")
      .select("id,placa,marca,modelo,ano,cor,chassi,km_atual,foto_url")
      .eq("placa", data.placa)
      .eq("status", "archived")
      .is("user_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!archived) return { found: false };

    const { data: claimed, error: upErr } = await supabaseAdmin
      .from("veiculos")
      .update({
        user_id: context.userId,
        status: "ativo",
        history_locked: true,
        claimed_at: new Date().toISOString(),
        // Patch F: zera KMs de manutenção herdadas do dono anterior — esses
        // valores alimentam o semáforo e revelam histórico operacional.
        // km_atual (estado físico do veículo) é preservado.
        km_ultima_troca_oleo: null,
        km_ultima_troca_filtros: null,
        km_ultima_troca_pastilhas: null,
        km_ultima_troca_arrefecimento: null,
      })
      .eq("id", archived.id)
      .eq("status", "archived")
      .is("user_id", null)
      .select("id,placa,marca,modelo,ano,cor,chassi,km_atual,foto_url")
      .maybeSingle();
    if (upErr) throw new Error(upErr.message);
    if (!claimed) return { found: false };
    return { found: true, vehicle: claimed };
  });

/**
 * Soft-delete: arquiva o veículo (status='archived', user_id=null) preservando o
 * histórico para futuro resgate. Exige confirmação da placa pelo front, mas
 * revalida aqui também para evitar bypass.
 */
export const softDeleteVehicleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { vehicleId: string; placaConfirm: string }) => {
    if (!data?.vehicleId) throw new Error("vehicleId obrigatório.");
    const placa = sanitizePlate(data?.placaConfirm ?? "");
    if (!placa) throw new Error("Confirmação de placa obrigatória.");
    return { vehicleId: data.vehicleId, placaConfirm: placa };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("veiculos")
      .select("id,placa,user_id")
      .eq("id", data.vehicleId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Veículo não encontrado.");
    if (row.user_id !== context.userId) throw new Error("Acesso negado.");
    if (sanitizePlate(row.placa) !== data.placaConfirm) {
      throw new Error("A placa digitada não confere.");
    }
    const { error: upErr } = await supabaseAdmin
      .from("veiculos")
      .update({ user_id: null, status: "archived" })
      .eq("id", data.vehicleId);
    if (upErr) throw new Error(upErr.message);
    return { ok: true };
  });

/**
 * Destrava o histórico do veículo resgatado (Carfax Reverso paywall).
 * Para o MVP, apenas seta history_locked = false.
 */
export const unlockHistoryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { vehicleId: string }) => {
    if (!data?.vehicleId) throw new Error("vehicleId obrigatório.");
    return { vehicleId: data.vehicleId };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("veiculos")
      .select("user_id")
      .eq("id", data.vehicleId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || row.user_id !== context.userId) throw new Error("Acesso negado.");
    const { error: upErr } = await supabaseAdmin
      .from("veiculos")
      .update({ history_locked: false })
      .eq("id", data.vehicleId);
    if (upErr) throw new Error(upErr.message);
    return { ok: true };
  });

/**
 * Procura uma foto já gerada anteriormente para a MESMA placa (em qualquer
 * registro do banco, incluindo arquivados) e, se encontrar, vincula a URL ao
 * novo veículo recém-criado. Evita gastar uma chamada de IA quando o carro
 * já passou pelo nosso sistema antes.
 */
export const inheritVehicleImageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { vehicleId: string; placa: string }) => {
    if (!data?.vehicleId) throw new Error("vehicleId obrigatório.");
    const placa = sanitizePlate(data?.placa ?? "");
    if (!placa) throw new Error("Placa obrigatória.");
    return { vehicleId: data.vehicleId, placa };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Garante que o veículo de destino pertence ao usuário logado.
    const { data: target, error: tErr } = await supabaseAdmin
      .from("veiculos")
      .select("id,user_id,foto_url")
      .eq("id", data.vehicleId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!target || target.user_id !== context.userId) {
      throw new Error("Acesso negado.");
    }
    if (target.foto_url) return { inherited: false as const, url: target.foto_url };

    const { data: prior, error } = await supabaseAdmin
      .from("veiculos")
      .select("foto_url")
      .eq("placa", data.placa)
      .neq("id", data.vehicleId)
      .not("foto_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!prior?.foto_url) return { inherited: false as const, url: null };

    const { error: upErr } = await supabaseAdmin
      .from("veiculos")
      .update({ foto_url: prior.foto_url })
      .eq("id", data.vehicleId);
    if (upErr) throw new Error(upErr.message);
    return { inherited: true as const, url: prior.foto_url };
  });

export type RevendaItem = {
  id: string;
  data: string;
  valor: number;
  categoria: string;
  descricao: string;
  km_registro: number | null;
  receipt_image_url: string | null;
  created_at: string;
  vehicle_id: string;
};

/**
 * Relatório de Revenda — varre o banco inteiro filtrando pela placa.
 * Junta despesas de todos os donos passados que compartilham a mesma placa
 * (mesmo que estejam em vehicle_ids diferentes). Ordena cronologicamente
 * (mais recente primeiro). Requer que o usuário logado seja dono ATUAL de
 * algum veículo com essa placa.
 */
export const getRevendaHistoryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { placa: string }) => {
    const placa = sanitizePlate(data?.placa ?? "");
    if (!placa) throw new Error("Placa obrigatória.");
    return { placa };
  })
  .handler(async ({ data, context }): Promise<{ items: RevendaItem[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Confirma que o usuário é dono atual de pelo menos 1 veículo com essa placa.
    const { data: owned, error: oErr } = await supabaseAdmin
      .from("veiculos")
      .select("id,claimed_at,history_locked")
      .eq("placa", data.placa)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (oErr) throw new Error(oErr.message);
    if (!owned) throw new Error("Acesso negado.");

    // Patch H: entitlement do Histórico Premium R$49,90.
    // VIP ou history_locked=false → libera tudo (todos vehicle_ids da placa).
    // Caso contrário → restringe ao veículo do usuário atual + created_at >= claimed_at.
    const ownedRow = owned as { id: string; claimed_at: string | null; history_locked: boolean };
    const { data: prof, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("status_usuario")
      .eq("id", context.userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    const isVip = (prof as { status_usuario?: string } | null)?.status_usuario === "vip";
    const entitled = isVip || ownedRow.history_locked === false;

    let ids: string[];
    if (entitled) {
      const { data: vs, error: vErr } = await supabaseAdmin
        .from("veiculos")
        .select("id")
        .eq("placa", data.placa);
      if (vErr) throw new Error(vErr.message);
      ids = (vs || []).map((v) => v.id);
    } else {
      ids = [ownedRow.id];
    }
    if (ids.length === 0) return { items: [] };

    let query = supabaseAdmin
      .from("despesas")
      .select("id,data,valor,categoria,descricao,km_registro,receipt_image_url,created_at,vehicle_id")
      .in("vehicle_id", ids);
    if (!entitled && ownedRow.claimed_at) {
      // Patch I: filtro de histórico pré-claim aplicado no servidor.
      query = query.gte("created_at", ownedRow.claimed_at);
    }
    const { data: rows, error: dErr } = await query.order("data", { ascending: false });
    if (dErr) throw new Error(dErr.message);
    return {
      items: ((rows || []) as RevendaItem[]).map((r) => ({
        ...r,
        valor: Number(r.valor),
      })),
    };
  });
