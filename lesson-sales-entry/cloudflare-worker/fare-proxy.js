/**
 * Cloudflare Worker: proxies station-pair fare lookups to the Ekispert API
 * ("駅すぱあと API for Amazon"), keeping the access key server-side and
 * adding CORS so the static lesson-sales-entry app can call it directly.
 *
 * Deploy via the Cloudflare dashboard (Workers & Pages > Create Worker),
 * paste this file's contents in, then add a secret named
 * EKISPERT_ACCESS_KEY with the access key from your Ekispert purchase.
 *
 * Usage: GET <worker-url>?from=秋葉原&to=御茶ノ水
 * Response: { oneWayFare: number, roundFare: number, raw: {...} }
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const from = url.searchParams.get("from")?.trim();
    const to = url.searchParams.get("to")?.trim();
    if (!from || !to) {
      return json({ error: "from と to のクエリパラメータが必要です" }, 400);
    }
    if (!env.EKISPERT_ACCESS_KEY) {
      return json({ error: "EKISPERT_ACCESS_KEY が設定されていません（Worker の Settings > Variables で設定してください）" }, 500);
    }

    const apiUrl = new URL("https://api.ekispert.jp/v1/json/search/course/extreme");
    apiUrl.searchParams.set("key", env.EKISPERT_ACCESS_KEY);
    apiUrl.searchParams.set("viaList", `${from}:${to}`);
    apiUrl.searchParams.set("answerCount", "1");
    // Best-effort: asks for IC-card fare detail in the result. If Ekispert
    // rejects/ignores this, the response will just fall back to the plain
    // cash fare below (the app surfaces `raw` on failure so it's easy to
    // spot in testing and adjust this parameter).
    apiUrl.searchParams.set("condition", "ic");

    let ekispertRes;
    try {
      ekispertRes = await fetch(apiUrl.toString());
    } catch (err) {
      return json({ error: `Ekispert への接続に失敗しました: ${err}` }, 502);
    }

    const data = await ekispertRes.json().catch(() => null);
    if (!ekispertRes.ok || !data) {
      return json({ error: `Ekispert API エラー (HTTP ${ekispertRes.status})`, raw: data }, 502);
    }

    const course = data?.ResultSet?.Course;
    const firstCourse = Array.isArray(course) ? course[0] : course;
    const prices = firstCourse?.Price;
    const priceList = Array.isArray(prices) ? prices : prices ? [prices] : [];

    if (priceList.length === 0) {
      return json({ error: "経路・運賃が見つかりませんでした（駅名を確認してください）", raw: data }, 404);
    }

    const icPrice = priceList.find((p) => String(p?.Type ?? p?.kind ?? "").toLowerCase().includes("ic")) ?? priceList[0];

    const oneWayFare = Number(icPrice?.Oneway ?? icPrice?.oneway ?? 0);
    const roundFare = Number(icPrice?.Round ?? icPrice?.round ?? 0);

    if (!oneWayFare) {
      return json({ error: "運賃金額を読み取れませんでした", raw: data }, 502);
    }

    return json({ oneWayFare, roundFare, raw: icPrice });
  },
};
