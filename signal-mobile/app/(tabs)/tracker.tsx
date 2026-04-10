import { useState, useEffect, useCallback } from "react";
import {
  ScrollView, View, Text, Pressable, StyleSheet,
  ActivityIndicator, RefreshControl, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { getApplications, type Application } from "@/lib/api";
import { GradientBar } from "@/components/GradientBar";
import { StatusPieChart } from "@/components/StatusPieChart";
import {
  palette, brand, type as typ, shared, space, radii, gradients,
} from "@/constants/theme";

/* ── Colors ──────────────────────────────────────────────────── */

const DECISION_COLORS: Record<string, { bg: string; color: string; bar: string }> = {
  "Priority Apply": { bg: "rgba(81,173,229,0.12)", color: "#51ADE5", bar: "#51ADE5" },
  Apply:            { bg: "rgba(74,222,128,0.12)", color: "#4ade80", bar: "#4ade80" },
  Review:           { bg: "rgba(254,176,106,0.12)", color: "#FEB06A", bar: "#FEB06A" },
  Pass:             { bg: "rgba(148,163,184,0.12)", color: "#94a3b8", bar: "#64748b" },
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  saved:        { bg: "rgba(255,255,255,0.07)", color: "#51ADE5" },
  applied:      { bg: "rgba(254,176,106,0.15)", color: "#FEB06A" },
  interviewing: { bg: "rgba(167,139,250,0.15)", color: "#a78bfa" },
  offer:        { bg: "rgba(74,222,128,0.15)", color: "#4ade80" },
  rejected:     { bg: "rgba(248,113,113,0.10)", color: "#f87171" },
  withdrawn:    { bg: "rgba(255,255,255,0.05)", color: "#94a3b8" },
};

export default function TrackerScreen() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try { setApps(await getApplications(accessToken)); } catch {}
    setLoading(false);
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={shared.screen} edges={[]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={brand.orange} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // Analytics
  const total = apps.length;
  const applied = apps.filter((a) => a.application_status !== "saved").length;
  const interviewing = apps.filter((a) => a.application_status === "interviewing").length;
  const scores = apps.filter((a) => a.signal_score != null).map((a) => a.signal_score!);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const interviewRate = applied > 0 ? Math.round((interviewing / applied) * 100) : 0;
  const applyRate = total > 0 ? Math.round((applied / total) * 100) : 0;

  // Decision distribution
  const dist = { "Priority Apply": 0, Apply: 0, Review: 0, Pass: 0 };
  for (const a of apps) {
    const d = a.signal_decision;
    if (d && d in dist) (dist as any)[d]++;
  }
  const maxDist = Math.max(...Object.values(dist), 1);

  return (
    <SafeAreaView style={shared.screen} edges={[]}>
      <ScrollView
        contentContainerStyle={shared.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={brand.orange} />}
      >
        <Text style={s.title}>Tracker</Text>

        {/* ── Pipeline Analytics ────────────────────────────── */}
        <View style={s.analyticsCard}>
          <GradientBar colors={gradients.primary} />
          <View style={s.analyticsInner}>
            <Text style={s.analyticsEyebrow}>PIPELINE</Text>
            <View style={s.metricsRow}>
              <MetricBox label="Total" value={String(total)} color={brand.blue} active={activeFilter === "total"} onPress={() => setActiveFilter(activeFilter === "total" ? null : "total")} />
              <MetricBox label="Applied" value={String(applied)} color={brand.orange} active={activeFilter === "applied"} onPress={() => setActiveFilter(activeFilter === "applied" ? null : "applied")} />
              <MetricBox label="Avg Score" value={avgScore > 0 ? String(avgScore) : "—"} color={palette.text} active={activeFilter === "scored"} onPress={() => setActiveFilter(activeFilter === "scored" ? null : "scored")} />
              <MetricBox label="Interview" value={`${interviewRate}%`} color="#a78bfa" active={activeFilter === "interviewing"} onPress={() => setActiveFilter(activeFilter === "interviewing" ? null : "interviewing")} />
              <MetricBox label="Apply Rate" value={`${applyRate}%`} color="#4ade80" active={activeFilter === "applied"} onPress={() => setActiveFilter(activeFilter === "applied" ? null : "applied")} />
            </View>

            {/* Decision distribution */}
            <View style={s.distSection}>
              <Text style={s.distEyebrow}>SCORE DISTRIBUTION</Text>
              <View style={s.distGrid}>
                {(["Priority Apply", "Apply", "Review", "Pass"] as const).map((key) => {
                  const c = DECISION_COLORS[key];
                  const count = dist[key];
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setActiveFilter(activeFilter === `decision:${key}` ? null : `decision:${key}`)}
                      style={[
                        s.distItem,
                        { borderColor: c.color + "30" },
                        activeFilter === `decision:${key}` && { borderColor: c.color, backgroundColor: c.color + "15" },
                      ]}
                    >
                      <Text style={[s.distLabel, { color: c.color }]}>
                        {key === "Priority Apply" ? "PRIORITY" : key.toUpperCase()}
                      </Text>
                      <Text style={[s.distNum, { color: c.color }]}>{count}</Text>
                      <View style={s.distBarTrack}>
                        <View style={[s.distBarFill, { width: `${pct}%`, backgroundColor: c.bar }]} />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        </View>

        {/* ── Status Pie Chart ───────────────────────────── */}
        {apps.length > 0 && (
          <StatusPieChart
            statusCounts={apps.reduce((acc, a) => {
              const st = a.application_status || "saved";
              acc[st] = (acc[st] || 0) + 1;
              return acc;
            }, {} as Record<string, number>)}
          />
        )}

        {/* ── Filtered Application List ──────────────────── */}
        {(() => {
          let filtered = apps;
          let filterLabel = "";

          if (activeFilter === "total") {
            filterLabel = "All Applications";
          } else if (activeFilter === "applied") {
            filtered = apps.filter((a) => a.application_status !== "saved");
            filterLabel = "Applied";
          } else if (activeFilter === "scored") {
            filtered = apps.filter((a) => a.signal_score != null);
            filterLabel = "With Scores";
          } else if (activeFilter === "interviewing") {
            filtered = apps.filter((a) => a.application_status === "interviewing");
            filterLabel = "Interviewing";
          } else if (activeFilter?.startsWith("decision:")) {
            const dec = activeFilter.replace("decision:", "");
            filtered = apps.filter((a) => a.signal_decision === dec);
            filterLabel = dec;
          }

          return (
            <>
              {activeFilter && (
                <Pressable
                  onPress={() => setActiveFilter(null)}
                  style={({ pressed }) => [s.filterBanner, pressed && { opacity: 0.7 }]}
                >
                  <Text style={s.filterBannerText}>
                    Showing: {filterLabel} ({filtered.length})
                  </Text>
                  <Text style={s.filterClear}>Clear filter</Text>
                </Pressable>
              )}
              <Text style={s.listEyebrow}>
                {activeFilter ? `${filterLabel.toUpperCase()} (${filtered.length})` : `APPLICATIONS (${total})`}
              </Text>
              {renderAppList(filtered)}
            </>
          );
        })()}
      </ScrollView>
    </SafeAreaView>
  );

  function renderAppList(list: Application[]) {
    if (list.length === 0) {
      return (
        <View style={s.emptyCard}>
          <Text style={s.emptyText}>
            {activeFilter ? "No applications match this filter." : "No applications tracked yet."}
          </Text>
          {!activeFilter && (
            <Text style={s.emptyHint}>
              Run Job Fit on a role and it will appear here automatically.
            </Text>
          )}
        </View>
      );
    }

    return (
      <>
        {list.map((app) => {
          const dc = DECISION_COLORS[app.signal_decision] ?? { bg: "transparent", color: palette.dim };
          const sc = STATUS_STYLE[app.application_status] ?? STATUS_STYLE.saved;
          return (
            <Pressable
              key={app.id}
              style={({ pressed }) => [s.appCard, pressed && { opacity: 0.7 }]}
              onPress={() => router.push(`/application/${app.id}` as any)}
            >
              <View style={s.appTop}>
                <View style={{ flex: 1 }}>
                  <Text style={s.appTitle} numberOfLines={1}>{app.job_title || "Untitled"}</Text>
                  <Text style={s.appCompany} numberOfLines={1}>{app.company_name || "Unknown"}</Text>
                </View>
                {app.signal_decision ? (
                  <View style={[s.appDecisionPill, { backgroundColor: dc.bg }]}>
                    <Text style={[s.appDecisionText, { color: dc.color }]}>{app.signal_decision}</Text>
                  </View>
                ) : null}
              </View>
              <View style={s.appBottom}>
                <View style={[s.appStatusPill, { backgroundColor: sc.bg }]}>
                  <Text style={[s.appStatusText, { color: sc.color }]}>{app.application_status}</Text>
                </View>
                {app.signal_score != null && (
                  <Text style={s.appMeta}>Score: {app.signal_score}</Text>
                )}
                {app.interview_count > 0 && (
                  <Text style={s.appMeta}>{app.interview_count} interview{app.interview_count > 1 ? "s" : ""}</Text>
                )}
                {app.jobfit_run_id ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation?.();
                      Linking.openURL(`https://wrnsignal.workforcereadynow.com/signal/jobfit?run=${app.jobfit_run_id}`);
                    }}
                    style={({ pressed }) => [s.signalLink, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={s.signalLinkText}>SIGNAL</Text>
                  </Pressable>
                ) : null}
                <FontAwesomeChevron />
              </View>
            </Pressable>
          );
        })}
      </>
    );
  }
}

function MetricBox({ label, value, color, active, onPress }: {
  label: string; value: string; color: string; active?: boolean; onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.metricBox,
        active && { borderColor: color, backgroundColor: color + "15" },
        pressed && onPress && { opacity: 0.7 },
      ]}
    >
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={[s.metricValue, { color }]}>{value}</Text>
    </Pressable>
  );
}

function FontAwesomeChevron() {
  return <Text style={{ color: palette.dim, fontSize: 12, marginLeft: "auto" }}>{"›"}</Text>;
}

const s = StyleSheet.create({
  title: { ...typ.h1, color: palette.text, marginBottom: space.xl },

  // Analytics
  analyticsCard: {
    borderRadius: radii.xl, borderWidth: 1, borderColor: palette.borderSoft,
    backgroundColor: palette.cardDeep, overflow: "hidden", marginBottom: space.xl,
  },
  analyticsInner: { padding: space.xl },
  analyticsEyebrow: { ...typ.eyebrow, color: brand.blue, marginBottom: space.lg },
  metricsRow: { flexDirection: "row", gap: 6, marginBottom: space.xl },
  metricBox: {
    flex: 1, padding: 10, borderRadius: radii.sm,
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: palette.borderSoft,
    alignItems: "center",
  },
  metricLabel: {
    fontSize: 8, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase",
    color: palette.dim, marginBottom: 4,
  },
  metricValue: { fontSize: 20, fontWeight: "900" },

  // Distribution
  distSection: { borderTopWidth: 1, borderTopColor: palette.borderSoft, paddingTop: space.lg },
  distEyebrow: { ...typ.eyebrow, color: palette.dim, marginBottom: space.md },
  distGrid: { flexDirection: "row", gap: 8 },
  distItem: {
    flex: 1, padding: 10, borderRadius: radii.sm,
    backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1,
    alignItems: "center",
  },
  distLabel: { fontSize: 7, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 },
  distNum: { fontSize: 22, fontWeight: "900", marginBottom: 6 },
  distBarTrack: {
    width: "100%", height: 3, backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 2, overflow: "hidden",
  },
  distBarFill: { height: "100%", borderRadius: 2 },

  // List
  // Filter banner
  filterBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radii.sm,
    backgroundColor: "rgba(254,176,106,0.08)",
    borderWidth: 1,
    borderColor: "rgba(254,176,106,0.20)",
    marginBottom: space.md,
  },
  filterBannerText: {
    fontSize: 13,
    fontWeight: "800",
    color: brand.orange,
  },
  filterClear: {
    fontSize: 12,
    fontWeight: "700",
    color: palette.dim,
    textDecorationLine: "underline",
  },

  listEyebrow: { ...typ.eyebrow, color: palette.dim, marginBottom: space.md },

  emptyCard: {
    padding: space["3xl"], borderRadius: radii.xl, borderWidth: 1,
    borderColor: palette.borderSoft, backgroundColor: palette.card, alignItems: "center",
  },
  emptyText: { fontSize: 14, color: palette.muted, textAlign: "center" },
  emptyHint: { fontSize: 12, color: palette.dim, textAlign: "center", marginTop: 4, lineHeight: 18 },

  // App cards
  appCard: {
    padding: space.lg, borderRadius: radii.lg, borderWidth: 1,
    borderColor: palette.borderSoft, backgroundColor: palette.card,
    marginBottom: 10,
  },
  appTop: {
    flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between",
    gap: 10, marginBottom: 8,
  },
  appTitle: { fontSize: 15, fontWeight: "900", color: palette.text },
  appCompany: { fontSize: 13, color: palette.muted, marginTop: 2 },
  appDecisionPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radii.pill },
  appDecisionText: { fontSize: 10, fontWeight: "900" },
  appBottom: { flexDirection: "row", alignItems: "center", gap: 10 },
  appStatusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill },
  appStatusText: { fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  appMeta: { fontSize: 11, color: palette.dim },
  signalLink: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.3)",
  },
  signalLinkText: {
    fontSize: 9,
    fontWeight: "900" as const,
    color: "#4ade80",
    letterSpacing: 0.5,
  },
});
