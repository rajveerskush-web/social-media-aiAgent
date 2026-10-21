import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Layers3, ShieldCheck, Sparkles, Target } from "lucide-react";
import { officeOptions } from "@/lib/campaign-options";

export default function Home() {
  const featuredOffice = officeOptions[0];

  return (
    <main className="soto-home">
      <header className="home-nav">
        <div className="home-nav-inner">
          <Link href="/" className="home-brand"><span className="home-brand-mark">S</span><span>SOTO</span></Link>
          <nav className="home-links" aria-label="Main navigation">
            <a href="#capabilities">Why SOTO</a>
            <a href="#how-it-works">How it works</a>
          </nav>
          <div className="home-nav-actions">
            <Link className="home-signin" href="/sign-in">Sign in</Link>
            <Link className="home-nav-cta" href="/sign-up">Get started <ArrowUpRight size={15} /></Link>
          </div>
        </div>
      </header>

      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="home-kicker"><span><Sparkles size={13} /></span> A workspace for ambitious ideas</span>
          <h1>Make your next<br />big idea <em>happen.</em></h1>
          <p>Give every campaign a clear identity and a place for your AI team to get to work. Start with a name, choose your office, and make it yours.</p>
          <div className="home-hero-actions">
            <Link className="home-primary-button" href="/sign-up">Create your workspace <ArrowRight size={17} /></Link>
            <Link className="home-secondary-button" href="#how-it-works"><span><ArrowDown size={15} /></span> See how it works</Link>
          </div>
          <div className="home-trust-note"><span className="home-trust-icon"><ShieldCheck size={16} /></span><span><strong>Your workspace stays yours.</strong><small>Secure account access, powered by InsForge.</small></span></div>
        </div>

        <div className="home-hero-visual" aria-label={`Preview of ${featuredOffice.title}`}>
          <div className="home-visual-orbit home-visual-orbit-one" />
          <div className="home-visual-orbit home-visual-orbit-two" />
          <div className="home-office-frame">
            <Image src={featuredOffice.image} alt="Warm, light-filled creative office" fill priority sizes="(max-width: 760px) 92vw, 48vw" />
            <div className="home-image-shade" />
            <div className="home-visual-top"><span className="home-live-dot" /> SOTO WORKSPACE <span>PREVIEW</span></div>
            <div className="home-office-caption"><span>YOUR AI AGENT OFFICE</span><strong>{featuredOffice.title}</strong><small>A place for the work ahead.</small></div>
          </div>
          <div className="home-float-card home-float-card-top"><span className="home-float-check"><Check size={13} /></span><span><strong>Campaign created</strong><small>Your idea has a home</small></span></div>
          <div className="home-float-card home-float-card-bottom"><span className="home-float-icon"><Target size={17} /></span><span><small>YOUR NEXT MOVE</small><strong>Choose a direction</strong></span><ArrowUpRight size={15} /></div>
          <span className="home-visual-index">01 <i /> 02</span>
        </div>
      </section>

      <section className="home-proof-strip" aria-label="Workspace principles">
        <span>DESIGNED TO HELP YOU</span>
        <div><span><Check size={14} /> Start with clarity</span><span><Check size={14} /> Shape your workspace</span><span><Check size={14} /> Return to your campaign</span></div>
      </section>

      <section className="home-capabilities" id="capabilities">
        <div className="home-section-heading"><span className="home-kicker">A CLEAR STARTING POINT</span><h2>Less setup. More <em>momentum.</em></h2><p>SOTO brings the first steps of your campaign into one thoughtful flow.</p></div>
        <div className="home-feature-grid">
          <article className="home-feature-card"><span className="home-feature-number">01</span><span className="home-feature-icon"><Layers3 size={21} /></span><h3>Give it a name</h3><p>Set a clear campaign identity with a name and an icon that feels like your idea.</p><Link href="/sign-up" aria-label="Create a campaign"><ArrowUpRight size={17} /></Link></article>
          <article className="home-feature-card home-feature-card-highlight"><span className="home-feature-number">02</span><span className="home-feature-icon"><Sparkles size={21} /></span><h3>Choose your office</h3><p>Pick an AI Agent Office that gives your campaign the right atmosphere.</p><Link href="/sign-up" aria-label="Choose an AI Agent Office"><ArrowUpRight size={17} /></Link></article>
          <article className="home-feature-card"><span className="home-feature-number">03</span><span className="home-feature-icon"><ShieldCheck size={21} /></span><h3>Come back to it</h3><p>Your campaign is saved to your account, ready when you sign in again.</p><Link href="/sign-in" aria-label="Sign in to your campaign"><ArrowUpRight size={17} /></Link></article>
        </div>
      </section>

      <section className="home-how" id="how-it-works">
        <div className="home-how-copy"><span className="home-kicker">YOUR FIRST FEW MINUTES</span><h2>From sign in to<br />settled in.</h2><p>A simple setup flow gives your campaign a foundation without getting in the way of your idea.</p><Link className="home-text-link" href="/sign-up">Start your campaign <ArrowRight size={16} /></Link></div>
        <div className="home-how-steps">
          <div><span>01</span><section><strong>Create an account</strong><p>Sign in securely with Google or your email.</p></section><Check size={16} /></div>
          <div><span>02</span><section><strong>Make it yours</strong><p>Choose your campaign name, icon, and office.</p></section><Check size={16} /></div>
          <div><span>03</span><section><strong>Open your dashboard</strong><p>Your campaign is saved and ready for your next visit.</p></section><ArrowUpRight size={16} /></div>
        </div>
      </section>

      <section className="home-final-cta"><div><span className="home-kicker">YOUR NEXT IDEA STARTS HERE</span><h2>Give it a place to grow.</h2><p>Set up your SOTO workspace in just a few steps.</p></div><Link className="home-primary-button" href="/sign-up">Get started <ArrowRight size={17} /></Link><span className="home-cta-mark" aria-hidden="true">S</span></section>
      <footer className="home-footer"><Link href="/" className="home-brand"><span className="home-brand-mark">S</span><span>SOTO</span></Link><span>A thoughtful space for what&apos;s next.</span><span>© {new Date().getFullYear()} SOTO AI</span></footer>
    </main>
  );
}
