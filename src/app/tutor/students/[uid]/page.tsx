"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useRequireTutor } from "@/lib/use-profile";
import type { Assignment, ProgressStats, Section, UserProfile } from "@/lib/client-types";
import { humanizeSubSkill, mastery } from "@/lib/labels";
import { MathText } from "@/components/MathText";

const DIFF_LABEL: Record<number, string> = { 2: "Easy", 3: "Medium", 4: "Hard" };

type SkillFacet = { skill: string; subSkills: string[] };
type SectionFacet = { section: Section; label: string; skills: SkillFacet[] };
type QPreview = {
  id: string;
  section: Section;
  skill: string;
  subSkill: string | null;
  difficulty: number;
  prompt: string;
  passage: string | null;
  stimulusImage: string | null;
  stimulusTableHtml: string | null;
  choices: { key: string; text: string }[];
  correctAnswer: string;
  explanation: string;
  hasStimulus: boolean;
};

type PTSummary = {
  id: string;
  title: string;
  status: "active" | "completed";
  createdAt: number;
  completedAt: number | null;
  totalAnswered: number;
  totalCorrect: number;
  pct: number;
  reading: { answered: number; correct: number; pct: number };
  math: { answered: number; correct: number; pct: number };
  modules: {
    id: string;
    title: string;
    section: string;
    tier: "easy" | "hard" | null;
    answered: number;
    correct: number;
    total: number;
  }[];
};

type MistakeItem = {
  questionId: string;
  section: string;
  skill: string;
  subSkill: string | null;
  difficulty: number;
  prompt: string;
  passage: string | null;
  stimulusImage: string | null;
  stimulusTableHtml: string | null;
  choices: { key: string; text: string }[];
  yourAnswer: string | null;
  correctAnswer: string;
  explanation: string;
};

interface Detail {
  profile: UserProfile;
  progress: ProgressStats;
  assignments: Assignment[];
  practiceTests: PTSummary[];
}

export default function StudentDetailPage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = use(params);
  const { profile: me, loading } = useRequireTutor();
  const { authedFetch } = useAuth();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [sections, setSections] = useState<SectionFacet[]>([]);
  const [difficulties, setDifficulties] = useState<number[]>([]);
  const [loadError, setLoadError] = useState("");

  // assignment form state
  const [title, setTitle] = useState("");
  const [selSections, setSelSections] = useState<Set<Section>>(new Set());
  const [selSkills, setSelSkills] = useState<Set<string>>(new Set());
  const [selSubs, setSelSubs] = useState<Set<string>>(new Set());
  const [diffs, setDiffs] = useState<Set<number>>(new Set());
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  // Assign-a-full-practice-test card.
  const [ptTitle, setPtTitle] = useState("");
  const [ptBusy, setPtBusy] = useState(false);

  // which skill rows are expanded to show subskill breakdown
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  function toggleExpand(skill: string) {
    setExpandedSkills((prev) => {
      const n = new Set(prev);
      if (n.has(skill)) n.delete(skill);
      else n.add(skill);
      return n;
    });
  }

  // specific-question picker
  const [pickMode, setPickMode] = useState(false);
  const [browse, setBrowse] = useState<QPreview[]>([]);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browsing, setBrowsing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<QPreview | null>(null);

  // mistakes drill-down (wrong questions on an assignment or practice test)
  const [mistakes, setMistakes] = useState<
    { title: string; items: MistakeItem[] } | null
  >(null);
  const [mistakesLoading, setMistakesLoading] = useState(false);

  const openMistakes = useCallback(
    async (kind: "assignment" | "practice", id: string) => {
      setMistakesLoading(true);
      setMistakes({ title: "Loading…", items: [] });
      try {
        const res = await authedFetch(
          `/api/tutor/students/${uid}/mistakes?kind=${kind}&id=${id}`,
        );
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Could not load mistakes");
        setMistakes(d);
      } catch (e) {
        setMistakes({
          title: e instanceof Error ? e.message : "Could not load mistakes",
          items: [],
        });
      } finally {
        setMistakesLoading(false);
      }
    },
    [authedFetch, uid],
  );

  const load = useCallback(() => {
    authedFetch(`/api/tutor/students/${uid}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load student");
        setDetail(d);
      })
      .catch((e) => setLoadError(e.message));
  }, [authedFetch, uid]);

  useEffect(() => {
    if (me?.role !== "tutor") return;
    load();
    authedFetch("/api/tutor/facets")
      .then((r) => r.json())
      .then((d) => {
        setSections(d.sections ?? []);
        setDifficulties(d.difficulties ?? []);
      })
      .catch(() => {});
  }, [me, load, authedFetch]);

  // Lookups derived from the facet tree.
  const skillToSection = useMemo(() => {
    const m = new Map<string, Section>();
    for (const sec of sections) for (const sk of sec.skills) m.set(sk.skill, sec.section);
    return m;
  }, [sections]);
  const skillToSubs = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const sec of sections) for (const sk of sec.skills) m.set(sk.skill, sk.subSkills);
    return m;
  }, [sections]);

  function toggleSection(sec: Section) {
    const next = new Set(selSections);
    if (next.has(sec)) {
      next.delete(sec);
      // prune skills (and their subskills) that belonged to this section
      const skills = new Set(selSkills);
      const subs = new Set(selSubs);
      for (const sk of [...skills]) {
        if (skillToSection.get(sk) === sec) {
          skills.delete(sk);
          for (const ss of skillToSubs.get(sk) ?? []) subs.delete(ss);
        }
      }
      setSelSkills(skills);
      setSelSubs(subs);
    } else {
      next.add(sec);
    }
    setSelSections(next);
  }

  function toggleSkill(skill: string) {
    const next = new Set(selSkills);
    if (next.has(skill)) {
      next.delete(skill);
      const subs = new Set(selSubs);
      for (const ss of skillToSubs.get(skill) ?? []) subs.delete(ss);
      setSelSubs(subs);
    } else {
      next.add(skill);
    }
    setSelSkills(next);
  }

  function toggleSub(sub: string) {
    const next = new Set(selSubs);
    if (next.has(sub)) next.delete(sub);
    else next.add(sub);
    setSelSubs(next);
  }

  function toggleDiff(d: number) {
    const next = new Set(diffs);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    setDiffs(next);
  }

  // Sections shown for skill-picking: the selected ones, or all if none chosen.
  const shownSections = selSections.size
    ? sections.filter((s) => selSections.has(s.section))
    : sections;

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setNotice("");
    setBusy(true);
    try {
      // Keep the payload consistent with what's actually visible/selected.
      const secSel = [...selSections];
      const skillsSel = [...selSkills].filter(
        (sk) => secSel.length === 0 || secSel.includes(skillToSection.get(sk) as Section),
      );
      const allowedSubs = new Set(skillsSel.flatMap((sk) => skillToSubs.get(sk) ?? []));
      const subsSel = [...selSubs].filter((ss) => allowedSubs.has(ss));

      const res = await authedFetch("/api/tutor/assignments", {
        method: "POST",
        body: JSON.stringify({
          studentId: uid,
          title,
          criteria: {
            sections: secSel,
            skills: skillsSel,
            subSkills: subsSel,
            difficulties: [...diffs],
            count,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not assign");
      setNotice(`Assigned “${data.assignment.title}” (${data.assignment.questionIds.length} questions).`);
      setTitle("");
      setSelSections(new Set());
      setSelSkills(new Set());
      setSelSubs(new Set());
      setDiffs(new Set());
      setCount(10);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not assign");
    } finally {
      setBusy(false);
    }
  }

  async function assignPracticeTest() {
    setFormError("");
    setNotice("");
    setPtBusy(true);
    try {
      const res = await authedFetch("/api/tutor/assignments", {
        method: "POST",
        body: JSON.stringify({
          studentId: uid,
          kind: "practice_test",
          blueprintId: "sat-practice-1",
          title: ptTitle,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not assign practice test");
      setNotice(`Assigned practice test “${data.assignment.title}”.`);
      setPtTitle("");
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not assign practice test");
    } finally {
      setPtBusy(false);
    }
  }

  const loadQuestions = useCallback(async () => {
    setBrowsing(true);
    try {
      const qs = new URLSearchParams();
      if (selSections.size) qs.set("section", [...selSections].join(","));
      if (selSkills.size) qs.set("skill", [...selSkills].join(","));
      if (selSubs.size) qs.set("subSkill", [...selSubs].join(","));
      if (diffs.size) qs.set("difficulty", [...diffs].join(","));
      qs.set("studentId", uid);
      qs.set("limit", "60");
      const res = await authedFetch(`/api/tutor/questions?${qs.toString()}`);
      const d = await res.json();
      setBrowse(d.questions ?? []);
      setBrowseTotal(d.total ?? 0);
    } catch {
      setBrowse([]);
      setBrowseTotal(0);
    } finally {
      setBrowsing(false);
    }
  }, [authedFetch, uid, selSections, selSkills, selSubs, diffs]);

  function togglePicked(id: string) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function assignPicked() {
    if (picked.size === 0) return;
    setBusy(true);
    setFormError("");
    setNotice("");
    try {
      const res = await authedFetch("/api/tutor/assignments", {
        method: "POST",
        body: JSON.stringify({
          studentId: uid,
          title,
          criteria: {
            sections: [...selSections],
            skills: [...selSkills],
            subSkills: [...selSubs],
            difficulties: [...diffs],
            count: picked.size,
          },
          questionIds: [...picked],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not assign");
      setNotice(
        `Assigned “${data.assignment.title}” (${data.assignment.questionIds.length} hand-picked questions).`,
      );
      setPicked(new Set());
      setTitle("");
      loadQuestions();
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not assign");
    } finally {
      setBusy(false);
    }
  }

  if (loading || (me?.role === "tutor" && !detail && !loadError)) {
    return (
      <main className="flex min-h-screen items-center justify-center text-ink-faint">
        Loading…
      </main>
    );
  }
  if (loadError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/tutor" className="text-accent-700 underline">
          ← Back
        </Link>
        <p className="mt-4 text-red-600">{loadError}</p>
      </main>
    );
  }
  if (!detail) return null;

  const pct = (a: number, c: number) => (a ? Math.round((c / a) * 100) : 0);
  const skillRows = Object.entries(detail.progress.bySkill).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/tutor" className="text-sm text-accent-700 underline">
        ← Back to roster
      </Link>
      <h1 className="mt-2 font-display text-3xl font-medium tracking-tight">
        {detail.profile.displayName || "Unnamed student"}
      </h1>
      <p className="mb-8 text-ink-muted">{detail.profile.email}</p>

      {/* Progress overview */}
      <section className="mb-8 grid grid-cols-3 gap-4">
        <Stat label="Questions answered" value={detail.progress.totalAnswered} />
        <Stat
          label="Overall accuracy"
          value={`${pct(detail.progress.totalAnswered, detail.progress.totalCorrect)}%`}
        />
        <Stat label="Skills practiced" value={skillRows.length} />
      </section>

      {/* Practice tests */}
      <section className="card mb-8">
        <h2 className="mb-3 font-display text-lg font-medium">Practice tests</h2>
        {detail.practiceTests.length === 0 ? (
          <p className="text-sm text-ink-faint">No practice tests taken yet.</p>
        ) : (
          <div className="space-y-3">
            {detail.practiceTests.map((t) => (
              <div key={t.id} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{t.title}</div>
                  {t.status === "completed" ? (
                    <span className="shrink-0 text-sm font-semibold text-accent-700">
                      {t.pct}% · {t.totalCorrect}/{t.totalAnswered}
                    </span>
                  ) : (
                    <span className="shrink-0 text-sm text-amber-600">In progress</span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                  <span>
                    R&amp;W {t.reading.correct}/{t.reading.answered} ({t.reading.pct}%)
                  </span>
                  <span>
                    Math {t.math.correct}/{t.math.answered} ({t.math.pct}%)
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {t.modules.map((m) => {
                    const short = m.title
                      .replace("Reading & Writing — Module ", "R&W M")
                      .replace("Math — Module ", "Math M");
                    return (
                      <span
                        key={m.id}
                        className="rounded border border-line px-2 py-0.5 text-[11px] text-ink-soft"
                      >
                        {short}
                        {m.tier ? ` · ${m.tier}` : ""}: {m.correct}/{m.total}
                      </span>
                    );
                  })}
                </div>
                {t.totalAnswered > 0 && (
                  <button
                    onClick={() => openMistakes("practice", t.id)}
                    className="mt-2 text-xs font-medium text-accent-700 underline"
                  >
                    View wrong questions →
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Per-skill breakdown — click a skill to drill into subskills */}
      <section className="card mb-8">
        <h2 className="mb-1 font-display text-lg font-medium">Skill breakdown</h2>
        <p className="mb-3 text-xs text-ink-faint">
          Click a skill to see subskill mastery. Mastery needs at least{" "}
          {/* keep in sync with MASTERY_MIN_ATTEMPTS */}4 attempts to register.
        </p>
        {skillRows.length === 0 ? (
          <p className="text-sm text-ink-faint">No practice yet.</p>
        ) : (
          <div className="divide-y divide-line">
            {skillRows.map(([skill, v]) => {
              const m = mastery(v.answered, v.correct);
              const subs = skillToSubs.get(skill) ?? [];
              const open = expandedSkills.has(skill);
              const subStats = detail.progress.bySubSkill ?? {};
              return (
                <div key={skill} className="py-2">
                  <button
                    onClick={() => toggleExpand(skill)}
                    className="flex w-full items-center gap-3 text-left"
                  >
                    <span className="w-3 shrink-0 text-ink-faint">
                      {subs.length ? (open ? "▾" : "▸") : ""}
                    </span>
                    <div className="w-52 shrink-0 text-sm">{skill}</div>
                    <div className="hidden h-2 flex-1 overflow-hidden rounded-full bg-paper-deep sm:block">
                      <div className="h-full bg-accent-600" style={{ width: `${m.pct}%` }} />
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${m.badge}`}>
                      {m.level}
                    </span>
                    <div className="w-20 shrink-0 text-right text-xs text-ink-muted">
                      {m.pct}% · {v.answered}
                    </div>
                  </button>

                  {open && (
                    <div className="mt-2 space-y-1.5 border-l-2 border-line pl-6">
                      {subs.length === 0 ? (
                        <p className="text-xs text-ink-faint">No subskills in the bank.</p>
                      ) : (
                        subs.map((ss) => {
                          const sv = subStats[ss] ?? { answered: 0, correct: 0 };
                          const sm = mastery(sv.answered, sv.correct);
                          return (
                            <div key={ss} className="flex items-center gap-3">
                              <div className="w-48 shrink-0 text-xs text-ink-soft" title={ss}>
                                {humanizeSubSkill(ss)}
                              </div>
                              <div className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-paper-deep sm:block">
                                <div
                                  className="h-full bg-accent-500"
                                  style={{ width: `${sm.pct}%` }}
                                />
                              </div>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${sm.badge}`}
                              >
                                {sm.level}
                              </span>
                              <div className="w-16 shrink-0 text-right text-[11px] text-ink-muted">
                                {sv.answered ? `${sm.pct}% · ${sv.answered}` : "—"}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Assign a full practice test */}
      <section className="card mb-8">
        <h2 className="mb-1 font-display text-lg font-medium">Assign a full practice test</h2>
        <p className="mb-3 text-sm text-ink-muted">
          A timed, adaptive digital-SAT simulation — Reading &amp; Writing and Math,
          two modules each (98 questions). The student takes it from their dashboard;
          the score lands back here when they finish.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mono-label mb-1.5 block">Title (optional)</label>
            <input
              className="input"
              value={ptTitle}
              onChange={(e) => setPtTitle(e.target.value)}
              placeholder="Full Practice Test 1"
            />
          </div>
          <button
            type="button"
            className="btn-primary shrink-0"
            disabled={ptBusy}
            onClick={assignPracticeTest}
          >
            {ptBusy ? "Assigning…" : "Assign practice test"}
          </button>
        </div>
      </section>

      {/* Assign a practice set */}
      <section className="card mb-8">
        <h2 className="mb-3 font-display text-lg font-medium">Assign a practice set</h2>
        <form onSubmit={assign} className="space-y-5">
          <div>
            <label className="mono-label mb-1.5 block">Title</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Transitions warm-up"
            />
          </div>

          {/* Section */}
          <div>
            <label className="mono-label mb-1.5 block">
              Section <span className="text-ink-faint">(none = both)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {sections.map((s) => (
                <Chip
                  key={s.section}
                  active={selSections.has(s.section)}
                  onClick={() => toggleSection(s.section)}
                >
                  {s.label}
                </Chip>
              ))}
            </div>
          </div>

          {/* Skills + subskills, grouped by section */}
          <div className="space-y-3">
            {shownSections.map((sec) => (
              <div key={sec.section} className="rounded-lg border border-line p-3">
                <div className="mono-label mb-2">
                  {sec.label} — skills <span className="text-ink-faint">(none = any)</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {sec.skills.map((sk) => (
                    <Chip
                      key={sk.skill}
                      active={selSkills.has(sk.skill)}
                      onClick={() => toggleSkill(sk.skill)}
                    >
                      {sk.skill}
                    </Chip>
                  ))}
                </div>

                {sec.skills
                  .filter((sk) => selSkills.has(sk.skill) && sk.subSkills.length > 0)
                  .map((sk) => (
                    <div key={sk.skill} className="mt-3 border-l-2 border-line pl-3">
                      <div className="mb-1.5 text-xs font-medium text-ink-soft">
                        {sk.skill} — subskills{" "}
                        <span className="text-ink-faint">(none = all)</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {sk.subSkills.map((ss) => (
                          <Chip
                            key={ss}
                            small
                            active={selSubs.has(ss)}
                            onClick={() => toggleSub(ss)}
                            title={ss}
                          >
                            {humanizeSubSkill(ss)}
                          </Chip>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            ))}
          </div>

          {/* Difficulty + count */}
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <label className="mono-label mb-1.5 block">
                Difficulty <span className="text-ink-faint">(none = any)</span>
              </label>
              <div className="flex gap-2">
                {difficulties.map((d) => (
                  <Chip key={d} active={diffs.has(d)} onClick={() => toggleDiff(d)}>
                    {DIFF_LABEL[d] ?? d}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <label className="mono-label mb-1.5 block"># Questions</label>
              <input
                className="input w-24"
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </div>
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}
          {notice && <p className="text-sm text-green-700">{notice}</p>}
          <button className="btn-primary" disabled={busy}>
            {busy ? "Assigning…" : `Assign ${count} random from filters`}
          </button>

          {/* Or hand-pick specific questions matching the filters above */}
          <div className="border-t border-line pt-4">
            <button
              type="button"
              onClick={() => {
                const n = !pickMode;
                setPickMode(n);
                if (n && browse.length === 0) loadQuestions();
              }}
              className="text-sm font-medium text-accent-700 underline"
            >
              {pickMode ? "Hide specific picker" : "Or pick specific questions →"}
            </button>

            {pickMode && (
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-muted">
                    {browsing
                      ? "Loading…"
                      : `${browseTotal} unseen match your filters · showing ${browse.length}`}
                  </span>
                  <button
                    type="button"
                    onClick={loadQuestions}
                    className="text-xs text-accent-700 underline"
                  >
                    Refresh
                  </button>
                </div>

                <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-line p-2">
                  {browse.length === 0 && !browsing ? (
                    <p className="p-3 text-sm text-ink-faint">
                      No unseen questions match. Adjust the section/skill/difficulty filters above.
                    </p>
                  ) : (
                    browse.map((qq) => {
                      const on = picked.has(qq.id);
                      return (
                        <div
                          key={qq.id}
                          className={`flex items-start gap-3 rounded-md border p-2.5 ${
                            on ? "border-accent-600 bg-accent-50" : "border-line"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => togglePicked(qq.id)}
                            className="mt-1 h-4 w-4 shrink-0 accent-accent-600"
                          />
                          <div
                            className="min-w-0 flex-1 cursor-pointer"
                            onClick={() => togglePicked(qq.id)}
                          >
                            <div className="mb-1 flex flex-wrap gap-x-2 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                              <span>{qq.skill}</span>
                              <span>· {DIFF_LABEL[qq.difficulty] ?? qq.difficulty}</span>
                              {qq.subSkill && <span>· {humanizeSubSkill(qq.subSkill)}</span>}
                              <span>· ans {qq.correctAnswer}</span>
                              {qq.hasStimulus && <span>· has figure/passage</span>}
                            </div>
                            <div className="line-clamp-2 text-sm text-ink-soft">
                              {qq.section === "math" ? <MathText text={qq.prompt} /> : qq.prompt}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setViewing(qq)}
                            className="shrink-0 rounded border border-line px-2 py-1 text-xs font-medium text-accent-700 hover:bg-paper-soft"
                          >
                            View
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                <button
                  type="button"
                  onClick={assignPicked}
                  disabled={busy || picked.size === 0}
                  className="btn-primary disabled:opacity-40"
                >
                  {busy
                    ? "Assigning…"
                    : `Assign ${picked.size} selected question${picked.size === 1 ? "" : "s"}`}
                </button>
              </div>
            )}
          </div>
        </form>
      </section>

      {/* Assignment history */}
      <section className="card">
        <h2 className="mb-3 font-display text-lg font-medium">
          Assignments ({detail.assignments.length})
        </h2>
        {detail.assignments.length === 0 ? (
          <p className="text-sm text-ink-faint">Nothing assigned yet.</p>
        ) : (
          <div className="space-y-2">
            {detail.assignments.map((a) => {
              const isTest = a.kind === "practice_test";
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border border-line px-4 py-3"
                >
                  <div>
                    <div className="font-medium">{a.title}</div>
                    <div className="text-xs text-ink-faint">
                      {isTest
                        ? "Full practice test · 98 questions"
                        : `${a.questionIds.length} questions` +
                          (a.criteria.skills.length
                            ? ` · ${a.criteria.skills.join(", ")}`
                            : " · any skill")}
                    </div>
                    {!isTest && a.answered > 0 && a.correct < a.answered && (
                      <button
                        onClick={() => openMistakes("assignment", a.id)}
                        className="mt-1 text-xs font-medium text-accent-700 underline"
                      >
                        View wrong questions →
                      </button>
                    )}
                    {isTest && a.practiceTestId && a.answered > 0 && a.correct < a.answered && (
                      <button
                        onClick={() => openMistakes("practice", a.practiceTestId!)}
                        className="mt-1 text-xs font-medium text-accent-700 underline"
                      >
                        View wrong questions →
                      </button>
                    )}
                  </div>
                  <div className="text-right text-sm">
                    {a.status === "completed" ? (
                      <span className="font-medium text-green-700">
                        {pct(a.answered, a.correct)}% ({a.correct}/{a.answered})
                      </span>
                    ) : a.answered > 0 ? (
                      <span className="text-amber-600">
                        In progress
                        {isTest ? ` · ${a.answered} answered` : ` · ${a.answered}/${a.questionIds.length}`}
                      </span>
                    ) : (
                      <span className="text-ink-faint">Not started</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Mistakes drill-down */}
      {mistakes && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          onClick={() => setMistakes(null)}
        >
          <div
            className="my-8 w-full max-w-2xl rounded-xl bg-paper p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                  Wrong questions
                </div>
                <h3 className="font-display text-lg font-medium">{mistakes.title}</h3>
              </div>
              <button
                onClick={() => setMistakes(null)}
                className="shrink-0 text-ink-muted hover:text-ink"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {mistakesLoading ? (
              <p className="text-sm text-ink-faint">Loading…</p>
            ) : mistakes.items.length === 0 ? (
              <p className="text-sm text-ink-faint">
                No wrong answers — the student got everything they answered correct.
              </p>
            ) : (
              <div className="space-y-4">
                {mistakes.items.map((m, i) => (
                  <div key={m.questionId} className="rounded-lg border border-line p-3">
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                      {i + 1}. {m.skill} · {DIFF_LABEL[m.difficulty] ?? m.difficulty}
                      {m.subSkill ? ` · ${humanizeSubSkill(m.subSkill)}` : ""}
                    </div>

                    {m.stimulusImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.stimulusImage}
                        alt="Figure"
                        className="mb-2 max-h-56 w-auto rounded border border-line"
                      />
                    )}
                    {m.stimulusTableHtml && (
                      <div
                        className="stimulus-table mb-2"
                        dangerouslySetInnerHTML={{ __html: m.stimulusTableHtml }}
                      />
                    )}
                    {m.passage && m.passage.trim() && (
                      <div className="mb-2 whitespace-pre-line border-l-2 border-line pl-3 text-xs leading-relaxed text-ink-soft">
                        {m.passage}
                      </div>
                    )}

                    <p className="mb-2 text-sm font-medium text-ink">
                      {m.section === "math" ? <MathText text={m.prompt} /> : m.prompt}
                    </p>

                    <div className="space-y-1.5">
                      {m.choices.map((c) => {
                        const correct = c.key === m.correctAnswer;
                        const theirs = c.key === m.yourAnswer;
                        let cls =
                          "flex items-start gap-2 rounded-md border px-3 py-1.5 text-sm";
                        if (correct) cls += " border-green-500 bg-green-50";
                        else if (theirs) cls += " border-rose-400 bg-rose-50";
                        else cls += " border-line";
                        return (
                          <div key={c.key} className={cls}>
                            <span className="font-semibold">{c.key}.</span>
                            <span className="flex-1">
                              {m.section === "math" ? <MathText text={c.text} /> : c.text}
                            </span>
                            {correct && (
                              <span className="text-xs font-semibold text-green-700">correct</span>
                            )}
                            {theirs && !correct && (
                              <span className="text-xs font-semibold text-rose-700">
                                their answer
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {m.yourAnswer == null && (
                      <p className="mt-1.5 text-xs italic text-ink-faint">Left blank.</p>
                    )}

                    {m.explanation && (
                      <div className="mt-2 rounded-md bg-paper-soft p-2.5">
                        <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                          Explanation
                        </div>
                        <p className="text-xs leading-relaxed text-ink-soft">
                          {m.section === "math" ? (
                            <MathText text={m.explanation} />
                          ) : (
                            m.explanation
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <button onClick={() => setMistakes(null)} className="btn-primary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Question viewer */}
      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          onClick={() => setViewing(null)}
        >
          <div
            className="my-8 w-full max-w-2xl rounded-xl bg-paper p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
                {viewing.skill} · {DIFF_LABEL[viewing.difficulty] ?? viewing.difficulty}
                {viewing.subSkill ? ` · ${humanizeSubSkill(viewing.subSkill)}` : ""}
              </div>
              <button
                onClick={() => setViewing(null)}
                className="shrink-0 text-ink-muted hover:text-ink"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {viewing.stimulusImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={viewing.stimulusImage}
                alt="Figure for this question"
                className="mb-3 max-h-72 w-auto rounded border border-line"
              />
            )}
            {viewing.stimulusTableHtml && (
              <div
                className="stimulus-table mb-3"
                dangerouslySetInnerHTML={{ __html: viewing.stimulusTableHtml }}
              />
            )}
            {viewing.passage && viewing.passage.trim() && (
              <div className="mb-3 whitespace-pre-line border-l-2 border-line pl-3 text-sm leading-relaxed text-ink-soft">
                {viewing.passage}
              </div>
            )}

            <p className="mb-3 font-medium text-ink">
              {viewing.section === "math" ? <MathText text={viewing.prompt} /> : viewing.prompt}
            </p>

            <div className="space-y-2">
              {viewing.choices.map((c) => {
                const correct = c.key === viewing.correctAnswer;
                return (
                  <div
                    key={c.key}
                    className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                      correct ? "border-green-500 bg-green-50" : "border-line"
                    }`}
                  >
                    <span className="font-semibold">{c.key}.</span>
                    <span className="flex-1">
                      {viewing.section === "math" ? <MathText text={c.text} /> : c.text}
                    </span>
                    {correct && (
                      <span className="text-xs font-semibold text-green-700">correct</span>
                    )}
                  </div>
                );
              })}
            </div>

            {viewing.explanation && (
              <div className="mt-4 rounded-md bg-paper-soft p-3">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                  Explanation
                </div>
                <p className="text-sm leading-relaxed text-ink-soft">
                  {viewing.section === "math" ? (
                    <MathText text={viewing.explanation} />
                  ) : (
                    viewing.explanation
                  )}
                </p>
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => togglePicked(viewing.id)}
                className="btn-secondary"
              >
                {picked.has(viewing.id) ? "Remove from selection" : "Add to selection"}
              </button>
              <button type="button" onClick={() => setViewing(null)} className="btn-primary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Chip({
  active,
  onClick,
  children,
  small,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  small?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-full border ${
        small ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs"
      } ${
        active
          ? "border-accent-600 bg-accent-50 text-accent-700"
          : "border-line text-ink-soft hover:border-ink-faint"
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card text-center">
      <div className="font-display text-3xl font-medium tracking-tight">{value}</div>
      <div className="mt-1 mono-label">
        {label}
      </div>
    </div>
  );
}
