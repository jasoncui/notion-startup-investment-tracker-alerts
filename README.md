# Notion Startup Investment Tracker Alerts

Automated daily email reports for angel investment tracking using Notion database, GitHub Actions, and Resend.

## Features

- Daily email summaries of your investment portfolio
- Highlights action items based on "Next action date" field
- Categorizes items by urgency (overdue, due today, upcoming)
- Runs automatically via GitHub Actions
- Free to run using GitHub Actions free tier

## Setup

### 1. Prerequisites

- Notion database with investment tracking
- GitHub account
- Resend account (free tier works)

### 2. Required Notion Database Fields

Your Notion database should include these columns:
- Company Name
- Investment Date
- Amount Invested
- Current Status
- Next Action Date
- Next Action Description
- Notes

### 3. Configuration

1. Create a Notion integration at https://www.notion.so/my-integrations
2. Share your database with the integration
3. Get your database ID from the URL
4. Sign up for Resend and get your API key
5. Add the following secrets to your GitHub repository:
   - `NOTION_API_KEY`
   - `NOTION_DATABASE_ID`
   - `RESEND_API_KEY`
   - `REPORT_EMAIL_TO`

### 4. Customization

- Edit `.github/workflows/daily-report.yml` to adjust schedule
- Modify `.github/scripts/generate-report.js` for custom formatting
- Update email template in `.github/scripts/email-template.html`

## Usage

The workflow runs automatically every day at 8 AM EST. You can also trigger it manually from the Actions tab.

## License

MIT