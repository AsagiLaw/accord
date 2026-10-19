"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { newMediaDraft, RoomMediaFields, toMediaChoice, type RoomMediaDraft } from "@/components/RoomMediaFields";
import { PopupDialog } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/overlay";
import { createRoom, ROOM_TEMPLATES, type RoomTemplateId } from "@/lib/local/rooms";
import { squareIconFrom } from "@/lib/media/image";

/** 名前の最初の1文字（絵文字も1文字として扱う） */
const initial = (name: string) => Array.from(name.trim())[0] ?? "?";

function Choice({ icon, title, description, onClick, disabled }: { icon: IconName; title: string; description?: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={description}
      className="flex w-full items-center gap-3 rounded-[12px] border border-line px-4 py-3 text-left transition hover:bg-tint disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-tint text-accent">
        <Icon name={icon} size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{title}</span>
      </span>
      {!disabled && <Icon name="r" className="text-muted" />}
    </button>
  );
}

/**
 * ルームバーの「ルームを作る」で出すポップアップ。
 * 1画面目で始め方（オリジナル・テンプレート・サーバーに参加）を選び、2画面目でアイコンと名前、3画面目でメディアを決めて作る
 */
export function CreateRoomDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const router = useRouter();
  const [template, setTemplate] = useState<RoomTemplateId | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // 3画面目（メディア）を開いているときの設定。名前を決めてから開くので、ボックスの名前の初めの値に使える
  const [media, setMedia] = useState<RoomMediaDraft | null>(null);

  const chosen = ROOM_TEMPLATES.find((t) => t.id === template);

  if (!template) {
    return (
      <PopupDialog title="ルームを作る" onClose={onClose} width="max-w-md">
        <div data-name="ルームの始め方" className="space-y-2">
          <Choice icon="add" title="オリジナルの作成" description="チャット「雑談」だけの、まっさらなルーム" onClick={() => setTemplate("original")} />
          <p className="px-1 pt-3 text-xs font-bold text-muted">テンプレートから始める</p>
          {ROOM_TEMPLATES.map((t) => (
            <Choice key={t.id} icon={t.icon} title={t.name} description={t.description} onClick={() => setTemplate(t.id)} />
          ))}
          <div className="pt-3">
            <Choice icon="link" title="サーバーに参加" description="招待リンクで参加（準備中）" disabled />
          </div>
        </div>
      </PopupDialog>
    );
  }

  if (media) {
    return (
      <PopupDialog title="メディアの設定" onClose={onClose} width="max-w-md">
        <form
          data-name="ルームのメディア"
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed || busy) return;
            setBusy(true);
            const id = await createRoom(trimmed, userId, template, icon, toMediaChoice(media, trimmed));
            onClose();
            router.push(`/r/${id}`);
          }}
        >
          <RoomMediaFields userId={userId} value={media} onChange={setMedia} />
          <div className="flex justify-between gap-2">
            <button type="button" className="btn-sub" onClick={() => setMedia(null)}>
              <Icon name="back" />
              戻る
            </button>
            <button className="btn" disabled={busy || (media.kind === "box" && !media.boxId)}>
              新規作成
            </button>
          </div>
        </form>
      </PopupDialog>
    );
  }

  return (
    <PopupDialog title={chosen ? `テンプレート「${chosen.name}」` : "オリジナルの作成"} onClose={onClose} width="max-w-md">
      <form
        data-name="ルームの設定"
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          // 次の画面：メディアの設定
          setMedia(newMediaDraft(trimmed));
        }}
      >
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="アイコンの画像を選ぶ"
            className="relative grid h-20 w-20 place-items-center overflow-hidden rounded-[24px] bg-tint text-3xl font-bold text-muted transition hover:brightness-95"
          >
            {icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={icon} alt="" className="h-full w-full object-cover" />
            ) : (
              <span>{name.trim() ? initial(name) : <Icon name="camera" size={28} />}</span>
            )}
          </button>
          <div className="flex gap-3 text-sm">
            <button type="button" className="text-accent hover:underline" onClick={() => fileRef.current?.click()}>
              {icon ? "画像を変える" : "画像を選ぶ"}
            </button>
            {icon && (
              <button type="button" className="text-muted hover:underline" onClick={() => setIcon(undefined)}>
                画像を外す
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                setIcon(await squareIconFrom(file));
              } catch {
                toast("この画像は読み込めませんでした");
              }
            }}
          />
        </div>
        <label className="block">
          <span className="text-sm text-muted">
            サーバー名<span className="text-warn">（必須）</span>
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus className="field" />
        </label>
        <div className="flex justify-between gap-2">
          <button type="button" className="btn-sub" onClick={() => setTemplate(null)}>
            <Icon name="back" />
            戻る
          </button>
          <button className="btn" disabled={!name.trim()}>
            次へ
            <Icon name="r" />
          </button>
        </div>
      </form>
    </PopupDialog>
  );
}
