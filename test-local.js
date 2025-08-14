#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
require('dotenv').config();

// Import the main report functions
const {
  fetchInvestments,
  categorizeInvestments,
  generateEmailHTML,
  sendEmail
} = require('./.github/scripts/generate-report.js');

// Parse command line arguments
const args = process.argv.slice(2);
const flags = {
  help: args.includes('--help') || args.includes('-h'),
  dryRun: args.includes('--dry-run') || args.includes('-d'),
  sample: args.includes('--sample') || args.includes('-s'),
  saveHtml: args.includes('--save-html'),
  verbose: args.includes('--verbose') || args.includes('-v'),
  validate: args.includes('--validate'),
  preview: args.includes('--preview') || args.includes('-p'),
};

// Help text
if (flags.help) {
  console.log(`
Notion Investment Tracker - Local Testing Tool

Usage: npm run test:local [options]

Options:
  -h, --help        Show this help message
  -d, --dry-run     Fetch data and generate report without sending email
  -s, --sample      Use sample data instead of fetching from Notion
  -p, --preview     Generate HTML preview and open in browser
  --save-html       Save the generated HTML to 'report.html'
  --validate        Only validate configuration without running
  -v, --verbose     Show detailed logging

Examples:
  npm run test:local --dry-run          # Test with real data, don't send email
  npm run test:local --sample --preview  # Use sample data and preview in browser
  npm run test:local --validate          # Just check if configuration is valid
  `);
  process.exit(0);
}

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, type = 'info') {
  const prefix = {
    info: `${colors.blue}ℹ${colors.reset}`,
    success: `${colors.green}✓${colors.reset}`,
    warning: `${colors.yellow}⚠${colors.reset}`,
    error: `${colors.red}✗${colors.reset}`,
    debug: `${colors.magenta}●${colors.reset}`,
  };
  
  if (type === 'debug' && !flags.verbose) return;
  
  console.log(`${prefix[type] || prefix.info} ${message}`);
}

// Validate environment variables
function validateConfig() {
  log('Validating configuration...', 'info');
  
  const required = {
    NOTION_API_KEY: process.env.NOTION_API_KEY,
    NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    REPORT_EMAIL_TO: process.env.REPORT_EMAIL_TO,
  };
  
  const missing = [];
  const configured = [];
  
  for (const [key, value] of Object.entries(required)) {
    if (!value) {
      missing.push(key);
      log(`Missing: ${key}`, 'error');
    } else {
      configured.push(key);
      if (flags.verbose) {
        const masked = value.substring(0, 4) + '...' + value.substring(value.length - 4);
        log(`Found: ${key} = ${masked}`, 'debug');
      }
    }
  }
  
  if (missing.length > 0) {
    log(`\nConfiguration incomplete! Missing ${missing.length} required variables.`, 'error');
    log('Please create a .env file with the required variables (see .env.example)', 'warning');
    
    if (!flags.sample) {
      log('\nYou can still test with sample data using: npm run test:sample', 'info');
      return false;
    }
  } else {
    log('All required environment variables are configured!', 'success');
  }
  
  return missing.length === 0;
}

// Generate sample data for testing
function generateSampleData() {
  log('Generating sample investment data...', 'info');
  
  const companies = [
    'TechStart AI', 'FinanceFlow', 'HealthHub', 'EduLearn', 'GreenEnergy Co',
    'DataSync', 'CloudBase', 'SecureNet', 'MarketPlace Pro', 'AutoDrive'
  ];
  
  const actions = [
    'Schedule quarterly review call',
    'Review latest board deck',
    'Follow up on hiring plans',
    'Check product roadmap progress',
    'Discuss Series A fundraising',
    'Review financial statements',
    'Connect with new CEO',
    'Evaluate exit opportunities',
    'Update valuation model',
    'Schedule site visit'
  ];
  
  const statuses = ['Active', 'Active', 'Active', 'On Hold', 'Exited'];
  
  const today = new Date();
  const investments = [];
  
  for (let i = 0; i < 10; i++) {
    // Vary the dates to create different categories
    let nextActionDate;
    if (i < 2) {
      // Overdue
      nextActionDate = new Date(today);
      nextActionDate.setDate(today.getDate() - Math.floor(Math.random() * 10 + 1));
    } else if (i < 3) {
      // Due today
      nextActionDate = new Date(today);
    } else if (i < 5) {
      // This week
      nextActionDate = new Date(today);
      nextActionDate.setDate(today.getDate() + Math.floor(Math.random() * 6 + 1));
    } else {
      // This month
      nextActionDate = new Date(today);
      nextActionDate.setDate(today.getDate() + Math.floor(Math.random() * 20 + 7));
    }
    
    investments.push({
      id: `sample-${i}`,
      properties: {
        'Company Name': {
          title: [{ plain_text: companies[i] }]
        },
        'Next Action Date': {
          date: { start: nextActionDate.toISOString().split('T')[0] }
        },
        'Next Action Description': {
          rich_text: [{ plain_text: actions[i] }]
        },
        'Amount Invested': {
          number: Math.floor(Math.random() * 100000 + 10000)
        },
        'Current Status': {
          select: { name: statuses[Math.floor(Math.random() * statuses.length)] }
        },
        'Notes': {
          rich_text: [{ plain_text: `Sample note for ${companies[i]}` }]
        }
      },
      url: `https://notion.so/sample-${i}`
    });
  }
  
  log(`Generated ${investments.length} sample investments`, 'success');
  return investments;
}

// Main test function
async function testReport() {
  try {
    // Validation phase
    if (flags.validate) {
      const isValid = validateConfig();
      process.exit(isValid ? 0 : 1);
    }
    
    // Configuration check
    const configValid = validateConfig();
    if (!configValid && !flags.sample) {
      process.exit(1);
    }
    
    console.log(''); // Empty line for clarity
    
    // Data fetching phase
    let investments;
    if (flags.sample) {
      log('Using sample data (--sample flag detected)', 'info');
      investments = generateSampleData();
    } else {
      log('Fetching investments from Notion...', 'info');
      try {
        investments = await fetchInvestments();
        log(`Fetched ${investments.length} investments from Notion`, 'success');
      } catch (error) {
        log(`Failed to fetch from Notion: ${error.message}`, 'error');
        log('Try using --sample flag to test with sample data', 'info');
        process.exit(1);
      }
    }
    
    // Categorization phase
    log('Categorizing investments by action date...', 'info');
    const categorized = categorizeInvestments(investments);
    
    // Report summary
    console.log('');
    log('📊 Report Summary:', 'info');
    console.log(`   ${colors.red}● Overdue:${colors.reset}     ${categorized.overdue.length} items`);
    console.log(`   ${colors.yellow}● Due Today:${colors.reset}   ${categorized.dueToday.length} items`);
    console.log(`   ${colors.blue}● This Week:${colors.reset}   ${categorized.thisWeek.length} items`);
    console.log(`   ${colors.cyan}● This Month:${colors.reset}  ${categorized.thisMonth.length} items`);
    console.log('');
    
    // Show details if verbose
    if (flags.verbose) {
      if (categorized.overdue.length > 0) {
        log('Overdue items:', 'warning');
        categorized.overdue.forEach(item => {
          console.log(`   - ${item.companyName}: ${item.nextAction}`);
        });
      }
      
      if (categorized.dueToday.length > 0) {
        log('Due today:', 'info');
        categorized.dueToday.forEach(item => {
          console.log(`   - ${item.companyName}: ${item.nextAction}`);
        });
      }
    }
    
    // Generate HTML
    log('Generating HTML report...', 'info');
    const html = generateEmailHTML(categorized);
    log('HTML report generated successfully', 'success');
    
    // Save HTML if requested
    if (flags.saveHtml) {
      const htmlPath = path.join(__dirname, 'report.html');
      fs.writeFileSync(htmlPath, html);
      log(`HTML saved to: ${htmlPath}`, 'success');
    }
    
    // Preview in browser if requested
    if (flags.preview) {
      const tempPath = path.join(__dirname, 'temp-preview.html');
      fs.writeFileSync(tempPath, html);
      log('Opening preview in browser...', 'info');
      
      const platform = process.platform;
      const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${command} "${tempPath}"`, (error) => {
        if (error) {
          log(`Could not open browser: ${error.message}`, 'warning');
          log(`Preview saved to: ${tempPath}`, 'info');
        }
      });
    }
    
    // Send email if not dry run
    if (!flags.dryRun && !flags.sample) {
      log('Sending email via Resend...', 'info');
      
      await sendEmail(html, categorized);
      log(`Email sent successfully to ${process.env.REPORT_EMAIL_TO}`, 'success');
    } else {
      log('Email sending skipped (dry-run or sample mode)', 'info');
    }
    
    console.log('');
    log('Test completed successfully! ✨', 'success');
    
  } catch (error) {
    log(`Unexpected error: ${error.message}`, 'error');
    if (flags.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testReport();