package com.fantasysecretary.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private WebView webView;
    private final ExecutorService executor = Executors.newFixedThreadPool(4);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(11, 16, 32));
        getWindow().setNavigationBarColor(Color.rgb(11, 16, 32));
        getWindow().getDecorView().setSystemUiVisibility(0);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(11, 16, 32));
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setUserAgentString(webView.getSettings().getUserAgentString() + " FantasySecretary/0.1");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                return !("file".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme));
            }
        });
        webView.addJavascriptInterface(new NativeBridge(this), "FantasyNative");
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    public class NativeBridge {
        private final SharedPreferences prefs;
        private final Set<String> allowedHosts = new HashSet<>();

        NativeBridge(Context context) {
            prefs = context.getSharedPreferences("fantasy_secretary", Context.MODE_PRIVATE);
            allowedHosts.add("lm-api-reads.fantasy.espn.com");
            allowedHosts.add("fantasy.espn.com");
            allowedHosts.add("site.api.espn.com");
            allowedHosts.add("site.web.api.espn.com");
            allowedHosts.add("sports.core.api.espn.com");
        }

        @JavascriptInterface
        public String getSettings() {
            try {
                JSONObject o = new JSONObject();
                o.put("leagueId", prefs.getString("leagueId", ""));
                o.put("season", prefs.getString("season", "2026"));
                o.put("teamId", prefs.getString("teamId", ""));
                o.put("hasSwid", !prefs.getString("swid", "").isEmpty());
                o.put("hasS2", !prefs.getString("s2", "").isEmpty());
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void saveSettings(String json) {
            try {
                JSONObject o = new JSONObject(json);
                SharedPreferences.Editor ed = prefs.edit();
                if (o.has("leagueId")) ed.putString("leagueId", o.optString("leagueId", "").trim());
                if (o.has("season")) ed.putString("season", o.optString("season", "2026").trim());
                if (o.has("teamId")) ed.putString("teamId", o.optString("teamId", "").trim());
                if (o.has("swid")) {
                    String v = o.optString("swid", "").trim();
                    if (!v.isEmpty()) ed.putString("swid", v);
                }
                if (o.has("s2")) {
                    String v = o.optString("s2", "").trim();
                    if (!v.isEmpty()) ed.putString("s2", v);
                }
                ed.apply();
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void clearCredentials() {
            prefs.edit().remove("swid").remove("s2").apply();
        }

        @JavascriptInterface
        public void request(String url, String headersJson, String requestId) {
            executor.submit(() -> performRequest(url, headersJson, requestId));
        }

        private void performRequest(String rawUrl, String headersJson, String requestId) {
            int status = 0;
            String body;
            HttpURLConnection conn = null;
            try {
                URI uri = URI.create(rawUrl);
                String host = uri.getHost();
                if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || !allowedHosts.contains(host)) {
                    throw new SecurityException("Blocked host");
                }

                URL url = uri.toURL();
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(20000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) FantasySecretary/0.1");

                if (headersJson != null && !headersJson.trim().isEmpty()) {
                    JSONObject headers = new JSONObject(headersJson);
                    Iterator<String> keys = headers.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        if ("X-Fantasy-Filter".equalsIgnoreCase(key)) {
                            conn.setRequestProperty("X-Fantasy-Filter", headers.optString(key, ""));
                        }
                    }
                }

                if (host.endsWith("fantasy.espn.com")) {
                    String swid = prefs.getString("swid", "");
                    String s2 = prefs.getString("s2", "");
                    if (!swid.isEmpty() || !s2.isEmpty()) {
                        conn.setRequestProperty("Cookie", "SWID=" + swid + "; espn_s2=" + s2);
                    }
                }

                status = conn.getResponseCode();
                InputStream stream = (status >= 200 && status < 400) ? conn.getInputStream() : conn.getErrorStream();
                body = readAll(stream);
            } catch (Exception e) {
                body = "{\"error\":" + JSONObject.quote(e.getClass().getSimpleName() + ": " + e.getMessage()) + "}";
            } finally {
                if (conn != null) conn.disconnect();
            }

            final int finalStatus = status;
            final String finalBody = body == null ? "" : body;
            runOnUiThread(() -> {
                String js = "window.__nativeResponse(" + JSONObject.quote(requestId) + "," + finalStatus + "," + JSONObject.quote(finalBody) + ");";
                webView.evaluateJavascript(js, null);
            });
        }

        private String readAll(InputStream stream) throws Exception {
            if (stream == null) return "";
            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                char[] buffer = new char[8192];
                int n;
                while ((n = br.read(buffer)) >= 0) sb.append(buffer, 0, n);
            }
            return sb.toString();
        }
    }
}
