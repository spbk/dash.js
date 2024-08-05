const fs = require('fs');
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const rollupCommonjs = require('@rollup/plugin-commonjs');
const { fromRollup } = require('@web/dev-server-rollup');
const commonjs = fromRollup(rollupCommonjs);
const { seleniumLauncher } = require('@web/test-runner-selenium');
const webdriver = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const firefox = require('selenium-webdriver/firefox');
const { defaultReporter } = require('@web/test-runner');
const { junitReporter } = require('@web/test-runner-junit-reporter');
const { summaryReporter } = require('@web/test-runner');

const argv = yargs(hideBin(process.argv)).parse()
// Find the settings JSON object in the command arguments
const configFileName = argv.configfile
const streamsFileName = argv.streamsfile

if (!configFileName) {
    return
}

let testConfiguration = JSON.parse(fs.readFileSync(`test/functional/config/test-configurations/${configFileName}.json`, 'utf-8'));
const streamsConfiguration = JSON.parse(fs.readFileSync(`test/functional/config/test-configurations/streams/${streamsFileName}.json`, 'utf-8'));
const includedTestfiles = _getIncludedTestfiles(streamsConfiguration);
const excludedTestfiles = _getExcludedTestfiles(streamsConfiguration);
const browsers = _getBrowserConfiguration(testConfiguration);
const reporters = _getReporters(testConfiguration);
const testvectors = streamsConfiguration.testvectors;

if (testConfiguration && testConfiguration.type && testConfiguration.type === 'lambdatest') {
    testConfiguration = _adjustConfigurationForLambdatest(testConfiguration)
}

module.exports = {

    // base path that will be used to resolve all patterns (eg. files, exclude)
    rootDir: '../../../',

    // server options
    hostname: testConfiguration.hostname ? testConfiguration.hostname : 'localhost',
    port: testConfiguration.port ? testConfiguration.port : 9876,
    protocol: testConfiguration.protocol ? testConfiguration.protocol : 'http:',

    // list of files / patterns to load in the browser
    files: [
        '!test/functional/test/common/*.js',
    ].concat(includedTestfiles).concat(excludedTestfiles),

    // JS language target to compile down to using esbuild. Recommended value is "auto", which compiles based on user-agent.
    esbuildTarget: 'auto',

    // whether to analyze code coverage
    coverage: false,

    // amount of browsers to run concurrently
    concurrentBrowsers: 2,

    // 	Resolve bare module imports using node resolution.
    nodeResolve: true,

    browsers,

    plugins: [
        commonjs({
            include: [],
        })
    ],

    testFramework: {
        config: {
            timeout: '90000'
        }
    },

    reporters,

    debug: false,

    testRunnerHtml: function (testRunnerImport) {
        return `<html>
            <head>
                <title>dash.js test</title>
                <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
            </head>
          <body>
            <div id="ttml-rendering-div"></div>
            <div id="ad-ui"></div>
            <video id="video-element" controls style="width: 640px; height: 480px; background-color: black" muted></video>
            <script>
                window.testrunnerConfig = ${JSON.stringify({ 'testvectors': testvectors })};
            </script>
            <script type="module" src="${testRunnerImport}"></script>
          </body>
        </html>`
    },
}

function _getIncludedTestfiles(testConfiguration) {

    if (!testConfiguration || !testConfiguration.testfiles) {
        return []
    }

    if (!testConfiguration.testfiles.included || testConfiguration.testfiles.included.indexOf('all') >= 0) {
        return [`test/functional/test/**/*.js`]
    }

    return testConfiguration.testfiles.included.map((entry) => {
        return `test/functional/test/${entry}.js`
    })
}

function _getExcludedTestfiles(testConfiguration) {
    if (!testConfiguration || !testConfiguration.testfiles || !testConfiguration.testfiles.excluded) {
        return []
    }

    return testConfiguration.testfiles.excluded.map((entry) => {
        return `!test/functional/test/${entry}.js`
    })
}

function _getBrowserConfiguration(testConfiguration) {
    if (!testConfiguration || !testConfiguration.browsers || testConfiguration.browsers.length === 0 || !testConfiguration.seleniumServer) {
        return []
    }

    const seleniumServer = testConfiguration.seleniumServer;
    const browsers = [];
    testConfiguration.browsers.forEach((browserEntry) => {
        if (browserEntry.enabled) {
            switch (browserEntry.name) {
                case 'chrome':
                    browsers.push(_getChromeConfiguration(browserEntry, seleniumServer));
                    break;
                case 'firefox':
                    browsers.push(_getFirefoxConfiguration(browserEntry, seleniumServer));
                    break;
            }
        }
    })

    return browsers;
}

function _getChromeConfiguration(browserEntry, seleniumServer) {
    const options = new chrome.Options();
    browserEntry.flags.forEach((flag) => {
        options.addArguments(flag)
    })
    return seleniumLauncher({
        driverBuilder: new webdriver.Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .usingServer(seleniumServer),
    })
}

function _getFirefoxConfiguration(browserEntry, seleniumServer) {
    const options = new firefox.Options();
    browserEntry.flags.forEach((flag) => {
        options.setPreference(flag.key, flag.value);
    })
    return seleniumLauncher({
        driverBuilder: new webdriver.Builder()
            .forBrowser('firefox')
            .setFirefoxOptions(options)
            .usingServer(seleniumServer),
    })
}

function _getReporters(testConfiguration) {
    if (!testConfiguration || !testConfiguration.reporters || testConfiguration.reporters.length === 0) {
        return []
    }

    return testConfiguration.reporters.map((reporterEntry) => {
        switch (reporterEntry.name) {
            case 'default':
                return defaultReporter(reporterEntry.options)
            case 'junit':
                const outputPath = reporterEntry.options && reporterEntry.options.outputPath ? reporterEntry.options.outputPath : `test/functional/results/test/junit/${Date.now()}.xml`
                if (!reporterEntry.options) {
                    reporterEntry.options = {};
                }
                reporterEntry.options.outputPath = outputPath;
                return junitReporter(reporterEntry.options);
            case 'summary':
                return summaryReporter(reporterEntry.options)
        }
    })

}

function _adjustConfigurationForLambdatest(testConfiguration) {
    if (testConfiguration && testConfiguration.customLaunchers) {
        Object.keys(testConfiguration.customLaunchers).forEach((key) => {
            testConfiguration.customLaunchers[key].user = process.env.LAMBDATEST_USER;
            testConfiguration.customLaunchers[key].accessKey = process.env.LAMBDATEST_ACCESS_KEY;
            testConfiguration.customLaunchers[key].config = {
                hostname: 'hub.lambdatest.com',
                port: 80
            };
        })
    }

    return testConfiguration
}
