"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { ArrowLeft, ArrowRight, BrainCircuit, Check, ImagePlus, Rocket, Sparkles, Target, Upload, X } from "lucide-react";
import { createCampaign } from "@/app/actions/campaign";
import { campaignIcons, type OfficeOption } from "@/lib/campaign-options";

const iconComponents = { sparkles: Sparkles, rocket: Rocket, target: Target, brain: BrainCircuit };

export function CampaignWizard({ userName, offices, campaignDeletedNotice = false }: { userName: string; offices: OfficeOption[]; campaignDeletedNotice?: boolean }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [iconKey, setIconKey] = useState("sparkles");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState("");
  const [officeImage, setOfficeImage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (iconPreview) URL.revokeObjectURL(iconPreview);
  }, [iconPreview]);

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 256 * 1024) {
      setError("Choose a PNG, JPEG, or WebP image under 256 KB.");
      event.currentTarget.value = "";
      return;
    }
    setIconFile(file);
    setIconPreview(URL.createObjectURL(file));
    setIconKey("");
    setError("");
  }

  function submitCampaign() {
    setError("");
    const formData = new FormData();
    formData.set("name", name);
    formData.set("iconKey", iconKey);
    if (iconFile) formData.set("iconImage", iconFile);
    formData.set("officeImage", officeImage);
    startTransition(async () => {
      const result = await createCampaign(formData);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <main className="campaign-setup-shell">
      <aside className="campaign-setup-rail" aria-label="Setup progress">
        <a className="campaign-wordmark" href="/" aria-label="SOTO home"><span>S</span> SOTO</a>
        <div className="campaign-rail-copy">
          <span className="campaign-rail-kicker">YOUR AI WORKSPACE</span>
          <h2>Make room for<br />what&apos;s next.</h2>
          <p>Your agents work best when they have a place to call home.</p>
        </div>
        <div className="campaign-steps">
          <div className={`campaign-step ${step === 1 ? "is-active" : "is-complete"}`}>
            <span className="campaign-step-number">{step === 1 ? "01" : <Check size={15} />}</span>
            <span><strong>Campaign basics</strong><small>Name and identity</small></span>
          </div>
          <div className="campaign-step-line" />
          <div className={`campaign-step ${step === 2 ? "is-active" : ""}`}>
            <span className="campaign-step-number">02</span>
            <span><strong>Choose your office</strong><small>Set the scene</small></span>
          </div>
        </div>
        <div className="campaign-rail-art" aria-hidden="true">
          <span className="campaign-orbit campaign-orbit-one" />
          <span className="campaign-orbit campaign-orbit-two" />
          <span className="campaign-orbit-core"><Sparkles size={24} /></span>
          <span className="campaign-orbit-dot" />
        </div>
        <p className="campaign-rail-footnote">A thoughtful setup makes a better workspace.</p>
      </aside>

      <section className="campaign-setup-main">
        {campaignDeletedNotice && <p className="campaign-success-notice" role="status">Campaign deleted successfully. You can create a new campaign below.</p>}
        <div className="campaign-setup-topline">
          <span>Workspace setup <span className="campaign-topline-slash">/</span> <strong>{step === 1 ? "Campaign basics" : "Office selection"}</strong></span>
          <span className="campaign-user-chip"><span>{userName.slice(0, 1).toUpperCase()}</span>{userName}</span>
        </div>

        {step === 1 ? (
          <div className="campaign-step-content campaign-step-one">
            <div className="campaign-mobile-progress"><span>STEP 1 OF 2</span><i /></div>
            <span className="campaign-section-label">LET&apos;S GET STARTED</span>
            <h1>Give your campaign<br className="campaign-desktop-break" /> a name and a look.</h1>
            <p className="campaign-intro">Your campaign is the home for your AI agents, tasks, and momentum. Start with an identity that feels like yours.</p>

            <label className="campaign-field-label" htmlFor="campaign-name">Campaign name</label>
            <div className="campaign-name-wrap">
              <input id="campaign-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="e.g. Project Northstar" autoFocus />
              <span>{name.length}/80</span>
            </div>

            <div className="campaign-icon-heading">
              <div><span className="campaign-field-label">Choose an icon</span><p>Pick a mark for your campaign.</p></div>
              {iconFile && <button className="campaign-clear-upload" type="button" onClick={() => { setIconFile(null); setIconPreview(""); setIconKey("sparkles"); if (uploadRef.current) uploadRef.current.value = ""; }}>Remove upload <X size={14} /></button>}
            </div>
            <div className="campaign-icon-options" role="radiogroup" aria-label="Campaign icon">
              {campaignIcons.map(({ key, label }) => {
                const Icon = iconComponents[key];
                return (
                  <button key={key} type="button" role="radio" aria-checked={!iconFile && iconKey === key} className={`campaign-icon-option ${!iconFile && iconKey === key ? "is-selected" : ""}`} onClick={() => { setIconKey(key); setIconFile(null); setIconPreview(""); setError(""); if (uploadRef.current) uploadRef.current.value = ""; }} aria-label={label}>
                    <Icon size={22} strokeWidth={1.8} /><span>{label}</span>
                  </button>
                );
              })}
              <button type="button" className={`campaign-icon-upload ${iconFile ? "is-selected" : ""}`} onClick={() => uploadRef.current?.click()}>
                {iconPreview ? <Image src={iconPreview} alt="Uploaded campaign icon" width={30} height={30} unoptimized /> : <><ImagePlus size={20} /><span>Upload</span></>}
              </button>
              <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" className="campaign-file-input" onChange={handleUpload} aria-label="Upload a custom campaign icon" />
            </div>
            <p className="campaign-upload-note"><Upload size={13} /> PNG, JPG, or WebP. Up to 256 KB.</p>

            {error && <p className="campaign-form-error" role="alert">{error}</p>}
            <div className="campaign-actions campaign-actions-next">
              <span className="campaign-step-hint">You can change these details later.</span>
              <button className="campaign-primary-button" type="button" disabled={name.trim().length < 2} onClick={() => { setError(""); setStep(2); }}>
                Choose an office <ArrowRight size={17} />
              </button>
            </div>
          </div>
        ) : (
          <div className="campaign-step-content campaign-step-two">
            <div className="campaign-mobile-progress"><span>STEP 2 OF 2</span><i /></div>
            <span className="campaign-section-label">FIND YOUR FLOW</span>
            <h1>Where should your<br className="campaign-desktop-break" /> agents work?</h1>
            <p className="campaign-intro">Choose the AI Agent Office that sets the right tone. Your team can settle in as soon as your campaign is created.</p>

            <div className="campaign-office-grid" role="radiogroup" aria-label="Choose an AI Agent Office">
              {offices.map((office) => (
                <button type="button" role="radio" aria-checked={officeImage === office.id} key={office.id} className={`campaign-office-card ${officeImage === office.id ? "is-selected" : ""}`} onClick={() => { setOfficeImage(office.id); setError(""); }}>
                  <span className="campaign-office-art"><Image src={office.image} alt="" fill sizes="(max-width: 760px) 100vw, 33vw" /><span className="campaign-office-tag">{office.tag}</span><span className="campaign-office-check"><Check size={14} /></span></span>
                  <span className="campaign-office-info"><strong>{office.title}</strong><span>{office.description}</span></span>
                </button>
              ))}
            </div>
            {error && <p className="campaign-form-error" role="alert">{error}</p>}
            <div className="campaign-actions campaign-actions-create">
              <button type="button" className="campaign-back-button" onClick={() => setStep(1)}><ArrowLeft size={16} /> Back</button>
              <span className="campaign-step-hint">One last step, {userName.split(" ")[0]}.</span>
              <button className="campaign-primary-button" type="button" disabled={!officeImage || isPending} onClick={submitCampaign}>
                {isPending ? "Creating campaign..." : "Create campaign"}{!isPending && <ArrowRight size={17} />}
              </button>
            </div>
          </div>
        )}
        <footer className="campaign-setup-footer"><span>Copyright 2026 SOTO AI</span><span>Built for focused, ambitious teams</span></footer>
      </section>
    </main>
  );
}
