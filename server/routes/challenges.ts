import { Router, Request, Response } from 'express';
import { challengeManager } from '../challengeManager';
import { appSettings } from '../appState';
import { sourceCookieJar } from '../services/sourceHealthService';
import { sourceCircuitBreaker } from '../circuitBreaker';
import { assertSafeProxyTarget, fetchWithSsrfGuard } from '../security';
import { solveWithFlareSolverr, checkSolverBalance } from '../captchaSolver';
import { sourceCustomUserAgents } from '../../server';

export const challengesRouter = Router();

// GET /api/challenges - List active challenge alerts & configuration
challengesRouter.get("/api/challenges", (_req: Request, res: Response) => {
  const challenges = challengeManager.getActiveChallenges();
  const config = challengeManager.getConfig();
  res.json({
    count: challenges.length,
    challenges,
    config,
    solverAvailable: !!appSettings.flareSolverrUrl || !!appSettings.captchaApiKey,
  });
});

// POST /api/challenges/config - Update challenge watchdog configuration
challengesRouter.post("/api/challenges/config", (req: Request, res: Response) => {
  const config = challengeManager.updateConfig(req.body || {});
  res.json({ success: true, config });
});

// POST /api/challenges/:id/dismiss - Dismiss an active challenge alert
challengesRouter.post("/api/challenges/:id/dismiss", (req: Request, res: Response) => {
  const dismissed = challengeManager.dismissChallenge(String(req.params.id));
  res.json({ success: dismissed });
});

// POST /api/challenges/:id/solve-manual - Apply manual cookies / user-agent resolution
challengesRouter.post("/api/challenges/:id/solve-manual", (req: Request, res: Response) => {
  const { cookies, userAgent, sourceId: rawSourceId } = req.body || {};
  if (!cookies) return res.status(400).json({ error: "cookies array or header string is required" });

  const id = String(req.params.id);
  let sourceId = rawSourceId;
  if (!sourceId && id.startsWith('chn_')) {
    sourceId = id.replace(/^chn_/, '');
  }

  const cookieList: string[] = Array.isArray(cookies)
    ? cookies
    : String(cookies).split(';').map(c => c.trim()).filter(Boolean);

  if (sourceId) {
    sourceCookieJar.setCookies(sourceId, cookieList);
    if (userAgent) {
      sourceCustomUserAgents.set(sourceId, userAgent);
    }
    sourceCircuitBreaker.reset(sourceId);
    challengeManager.resolveChallenge(sourceId);
  } else {
    challengeManager.dismissChallenge(id);
  }

  res.json({
    success: true,
    message: `Applied ${cookieList.length} session cookie(s) for "${sourceId || id}". Circuit breaker reset.`,
  });
});

// POST /api/challenges/test - Trigger a simulated challenge alert for testing UI/webhooks
challengesRouter.post("/api/challenges/test", (req: Request, res: Response) => {
  const { sourceId, sourceName, challengeType, pageUrl } = req.body || {};
  const notif = challengeManager.recordChallenge({
    sourceId: sourceId || "asurascans_test",
    sourceName: sourceName || "Asura Scans (Test)",
    sourceUrl: pageUrl || "https://asurascans.com",
    challengeType: challengeType || "cloudflare_turnstile",
    httpStatus: 403,
  });
  res.json({
    success: true,
    notification: notif,
    challengeId: notif.id,
    message: `Registered test challenge ${notif.id}.`,
  });
});

// POST /api/crawler/bypass-fetch - Execute Cloudflare bypass or stealth browser fetch
challengesRouter.post('/api/crawler/bypass-fetch', async (req: Request, res: Response) => {
  const { targetUrl } = req.body;
  if (!targetUrl) return res.status(400).json({ error: 'targetUrl is required' });

  try {
    await assertSafeProxyTarget(String(targetUrl));
  } catch (err: any) {
    console.warn(`[Cloudflare Bypass Engine] Blocked unsafe crawler target: ${err?.message || err}`);
    return res.status(403).json({ error: 'Blocked crawler target', message: String(err?.message || err) });
  }

  try {
    if (appSettings.enableCloudflareBypass && appSettings.flareSolverrUrl) {
      try {
        const solverRes = await fetch(appSettings.flareSolverrUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cmd: 'request.get',
            url: targetUrl,
            maxTimeout: appSettings.sourceTimeoutSeconds * 1000,
          }),
        });

        if (solverRes.ok) {
          const solverData: any = await solverRes.json();
          if (solverData.status === 'ok' && solverData.solution) {
            return res.json({
              success: true,
              methodUsed: 'FlareSolverr Cloudflare Bypass',
              cookies: solverData.solution.cookies,
              userAgent: solverData.solution.userAgent,
              htmlContent: solverData.solution.response,
            });
          }
        }
      } catch {}
    }

    const directRes = await fetchWithSsrfGuard(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': new URL(targetUrl).origin,
      },
    });

    const htmlText = await directRes.text();
    return res.json({
      success: true,
      methodUsed: 'Stealth Browser Engine',
      statusCode: directRes.status,
      htmlContent: htmlText,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to bypass Cloudflare challenge', details: err.message });
  }
});

// POST /api/solver/test-flaresolverr - Test connectivity to configured FlareSolverr instance
challengesRouter.post("/api/solver/test-flaresolverr", async (req: Request, res: Response) => {
  const testUrl = req.body?.url || appSettings.flareSolverrUrl || "http://localhost:8191/v1";
  try {
    const result = await solveWithFlareSolverr("https://nowsecure.nl", testUrl, 15);
    res.json({
      success: result.ok,
      status: result.status,
      latencyMs: result.responseTimeMs,
      message: result.ok ? "FlareSolverr connection verified and active!" : (result.error || "Failed to solve challenge"),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/solver/check-balance - Query 2Captcha / Anti-Captcha balance
challengesRouter.post("/api/solver/check-balance", async (req: Request, res: Response) => {
  const key = req.body?.apiKey || appSettings.captchaApiKey;
  if (!key) return res.status(400).json({ success: false, error: "No API key configured" });
  try {
    const result = await checkSolverBalance(key, req.body?.provider || "auto");
    res.json({
      success: result.ok,
      provider: result.provider,
      balance: result.balance,
      currency: result.currency,
      error: result.error,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
