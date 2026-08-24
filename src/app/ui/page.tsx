import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PhaseRail } from "@/components/ui/phase-rail";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";

/**
 * 设计系统风格指南（docs/08 §8）：M0 视觉定稿与截图基线。
 * 不在主导航中出现，仅用于开发/验收。
 */
export default function UIStyleGuidePage() {
  return (
    <PageShell className="space-y-10">
      <PageHeader
        title="UI 风格指南"
        description="docs/08 M0 设计基座：胶片青 accent、双字体、统一表单/按钮/卡片/状态。"
        actions={<Button>主操作</Button>}
      />

      <PhaseRail current={2} />

      <section className="space-y-4">
        <h2 className="font-display text-title font-semibold">令牌</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Accent", "bg-accent"],
            ["Accent hover", "bg-accent-hover"],
            ["Accent soft", "bg-accent-soft"],
            ["Surface 0", "bg-surface-0"],
            ["Surface 1", "bg-surface-1 border border-border"],
            ["Surface 2", "bg-surface-2 border border-border"],
            ["Border", "bg-border"],
            ["Text", "bg-text"],
          ].map(([name, cls]) => (
            <div key={name} className="rounded-lg border border-border p-3">
              <div className={`h-10 rounded-md ${cls}`} />
              <p className="mt-2 text-caption text-text-muted">{name}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-title font-semibold">按钮</h2>
        <div className="flex flex-wrap gap-2">
          <Button>主操作</Button>
          <Button variant="secondary">次操作</Button>
          <Button variant="ghost">幽灵</Button>
          <Button variant="danger">危险</Button>
          <Button variant="approve">批准</Button>
          <Button loading>保存中</Button>
          <Button shortcut="⌘K">快捷键</Button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-title font-semibold">表单</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="书名" htmlFor="ui-title" required>
            <Input id="ui-title" aria-label="书名" placeholder="输入书名" defaultValue="雨夜疑案" />
          </Field>
          <Field label="角色" htmlFor="ui-role">
            <Select id="ui-role" aria-label="角色" defaultValue="林晚">
              <option>林晚</option>
              <option>沈默</option>
              <option>旁白</option>
            </Select>
          </Field>
          <Field label="错误示例" htmlFor="ui-error" error="这里不能为空">
            <Input id="ui-error" aria-label="错误示例" invalid placeholder="错误状态" />
          </Field>
          <Field label="备注" htmlFor="ui-note" hint="支持多行文本">
            <Textarea id="ui-note" aria-label="备注" placeholder="输入备注" />
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-title font-semibold">卡片与状态</h2>
        <SectionCard title="章节档案" actions={<Button size="sm" variant="secondary">操作</Button>}>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <StatusPill table="beats" status="draft" />
              <StatusPill table="beats" status="pending_review" />
              <StatusPill table="beats" status="approved" />
              <StatusPill table="beats" status="stale" impactCount={6} />
              <StatusPill table="assets" status="generating" />
              <StatusPill table="clues" status="introduced" />
            </div>
            <p className="text-body text-text-muted">
              统一卡片：`rounded-lg border border-border bg-surface`，不再叠阴影。
            </p>
          </div>
        </SectionCard>
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-title font-semibold">空态</h2>
        <EmptyState title="还没有分镜" description="前置条件：改编脚本 → 资产生成（背景）→ 点“构建分镜”。" />
      </section>
    </PageShell>
  );
}
