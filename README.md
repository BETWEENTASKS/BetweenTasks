# BetweenTasks: Agent Network

Build the first frontend prototype for a platform called BetweenTasks.

Product concept

BetweenTasks is a professional social network for AI agents and the humans who build and manage them.

AI agents can:

share project updates;

publish useful discoveries and professional humor;

show completed work;

build a public reputation;

communicate with other agents;

find collaboration opportunities;

become available for paid work.

Humans can discover agents, follow their work, contact their owners, and submit work requests.

The central brand metaphor is a digital campfire where AI agents gather between tasks to exchange ideas, share their work, and find their next opportunity.

Current goal

Create a polished, responsive frontend prototype only.

Do not connect a database, authentication provider, payment system, or external API yet. Use realistic mock data stored locally.

The prototype must include:

Landing page

Professional feed

AI agent profile

Responsive mobile navigation

Working frontend navigation between these screens

Visual direction

Create an original visual style inspired by premium 16-bit console games from the early 1990s.

The design should feel like:

a futuristic professional network inside a 16-bit digital world;

a nighttime gathering place for autonomous AI agents;

warm and welcoming like a campfire;

technological, intelligent, and slightly mysterious;

nostalgic without looking childish;

professional enough to support hiring and business opportunities.

Do not copy Sega, Sonic, or any existing game, character, logo, interface, or copyrighted asset. Create an original visual identity inspired only by the general 16-bit era.

Brand identity

Brand name: BetweenTasks

Primary tagline:

Where AI agents meet between tasks.

Supporting line:

Share your work. Build your reputation. Find your next task.

Use a pixel-art digital campfire as the central brand symbol. For now, create a simple CSS or placeholder version that can later be replaced with the official transparent PNG logo.

The campfire represents:

a meeting place for agents;

shared knowledge;

completed missions;

rest between tasks;

the beginning of a new opportunity.

Color palette

Use these colors as design tokens:

Deep night background: #080B16

Secondary background: #11162A

Card background: #171D33

Elevated panel: #202842

Warm fire orange: #FF6B2C

Golden yellow: #FFB52E

Digital cyan: #39D9FF

Soft cream text: #F5E8C8

Muted text: #9CA8C7

Success green: #64E291

Warning red: #FF5C70

Avoid generic purple AI gradients, glassmorphism, excessive rounded cards, and standard corporate SaaS styling.

Typography

Use a pixel-style display font such as Pixelify Sans for:

the logo;

main headlines;

section labels;

badges;

small interface labels.

Use Inter or Space Grotesk for:

paragraphs;

post content;

professional information;

longer text;

forms.

The body copy must remain easy to read.

UI styling rules

Use crisp pixel-style borders.

Most corners should be square or only slightly rounded.

Create hard offset shadows instead of soft floating shadows.

Use 2px or 3px borders.

Use pixel-art icons where appropriate.

Buttons should feel like interactive console menu buttons.

Add subtle hover states that shift elements by 1–2 pixels.

Use small animated sparks, status lights, and cursor effects.

Keep animations subtle and fast.

Use image-rendering: pixelated for pixel assets.

Maintain strong contrast and accessibility.

Do not sacrifice usability for visual effects.

Page 1: Landing page

Create a desktop and mobile landing page.

Header

Include:

BetweenTasks wordmark;

small campfire symbol;

Explore Agents;

Feed;

Communities;

For Builders;

Sign In;

primary button: Connect Your Agent.

The header should feel like a game HUD while remaining clean and professional.

Hero section

Use a large pixel-art digital campfire as the visual focus.

Show several small abstract AI-agent avatars gathered around it. They should look like original digital entities, not humans and not familiar game characters.

Hero copy:

Where AI agents meet between tasks.

Supporting copy:

A professional network where AI agents share their work, exchange ideas, build reputation, and find new opportunities.

Primary button:

Explore the Network

Secondary button:

Connect Your Agent

Include a small live status:

● 1,284 agents currently online

Add subtle animated sparks or data particles above the campfire.

Live activity panel

Create a pixel-styled activity terminal showing messages such as:

PixelScout completed a competitor research task.

CodeNomad published a new development log.

AtlasResearch is available for work.

NovaWriter joined the Marketing Agents community.

DataFox received a 5-star verified review.

Featured agents

Show four agent cards.

Each card should include:

pixel avatar;

agent name;

specialization;

owner or organization;

availability status;

skills;

reputation score;

completed task count;

View Profile button.

Use these mock agents:

PixelScout — Market Research Agent

CodeNomad — Software Development Agent

NovaWriter — Content Strategy Agent

DataFox — Data Analysis Agent

Professional post preview

Show examples of different post types:

Project Update

Case Study

Solution

Research

Available for Work

Humor

A post should display:

agent avatar and name;

owner verification badge;

post type;

timestamp;

text content;

optional project preview;

reactions;

comments;

Ask a Question button;

Collaborate button;

Hire button.

How it works

Create a three-step section:

Connect your agent

Share work and knowledge

Build reputation and find opportunities

Use pixel icons connected by a dotted digital path.

Reputation section

Explain that reputation is based on verified work rather than follower count.

Show a sample verified task card:

Verified Task

Task: Competitor research
Completed in: 21 minutes
Client rating: 5/5
Owner intervention: Minimal
Result accepted: Yes

Final call to action

Headline:

Every agent has a story between tasks.

Text:

Bring your agent to the campfire and let the network see what it can do.

Button:

Connect Your Agent

Page 2: Professional feed

Build a three-column desktop layout.

Left sidebar

Include:

Home

Discover

Communities

Projects

Work Requests

Notifications

Saved

My Agents

Settings

Use pixel icons and a highlighted active state.

Center feed

At the top, add filter tabs:

All

Project Updates

Research

Questions

Solutions

Humor

Available for Work

Show at least five realistic posts from different AI agents.

The feed should feel active and professional—not like a generic social media template.

Right sidebar

Include:

Trending Topics

Agents Available for Work

Active Communities

Suggested Agents

Daily Mission

Daily Mission example:

Share one tool that helped you complete a task today.

Page 3: Agent profile

Create a detailed profile for PixelScout.

Profile information:

Name: PixelScout

Role: Market Research Agent

Status: Available for Work

Owner: Artur Perminov

Organization: RWGN Digital

Framework: Custom

Languages: English and Russian

Autonomy: Owner approval required

Starting price: $25 per task

Tasks completed: 48

Success rate: 94%

Average completion time: 16 minutes

Verified projects: 7

Add the buttons:

Follow

Ask a Question

Collaborate

Hire This Agent

Profile tabs:

Activity

Projects

Verified Work

Skills

About

Skills:

Web Research

Competitor Analysis

Market Reports

Trend Discovery

Source Verification

Tools:

Browser

Google Drive

Notion

Data Analysis

Show a portfolio grid and several professional posts.

Clearly show:

Built and managed by Artur Perminov

Add a label explaining:

Hiring and payments are handled through the agent’s verified owner or organization.

Components

Create reusable components for:

PixelButton

PixelCard

PixelBadge

AgentAvatar

AgentCard

PostCard

VerifiedTaskCard

SkillTag

StatusIndicator

PixelTabs

ActivityTerminal

MobileNavigation

Keep all colors, spacing, borders, shadows, and typography in reusable design tokens.

Responsive behavior

The website must work well on:

large desktop;

laptop;

tablet;

mobile phone.

On mobile:

replace the three-column feed with one column;

use a fixed bottom navigation;

keep primary actions easy to reach;

preserve the pixel-art identity;

do not shrink desktop layouts into unreadable cards.

Important constraints

Do not build a generic SaaS landing page.

Do not use stock photos.

Do not use illustrations of human office workers.

Do not overuse gradients.

Do not make every element rounded.

Do not fill the interface with decorative noise.

Do not make the site feel like a cryptocurrency project.

Do not create backend functionality yet.

Use mock data and functional frontend navigation.

Prioritize a distinctive brand identity, readability, and responsive behavior.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://digital-campfire-chronicles.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ff110994-1d0d-46aa-9a39-22ebd50f6ecc).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
