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

## Local Testing

### Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up your environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Test with sample data (no API keys needed):**
   ```bash
   npm run test:sample
   ```

### Testing Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run with real data in dry-run mode (no email sent) |
| `npm run test:sample` | Test with sample data and preview in browser |
| `npm run test:validate` | Validate your configuration |
| `npm run test:preview` | Generate report and preview in browser |
| `npm run test:verbose` | Run with detailed logging |
| `npm run test:local` | Run complete test with real data and send email |

### Testing Options

Run `node test-local.js --help` for all options:

- `--dry-run` - Generate report without sending email
- `--sample` - Use sample data instead of Notion API
- `--preview` - Open HTML report in browser
- `--save-html` - Save report to `report.html`
- `--validate` - Check configuration only
- `--verbose` - Show detailed logging

### Examples

```bash
# First time setup - validate configuration
npm run test:validate

# Test with sample data (no API needed)
npm run test:sample

# Test with real Notion data, don't send email
npm test

# Full test with real data and email
npm run test:local

# Debug issues with verbose logging
npm run test:verbose
```

## Production Usage

The workflow runs automatically every day at 8 AM EST. You can also trigger it manually from the Actions tab.

## License

MIT