const fs = require('node:fs/promises');
const path = require('node:path');

// Keep the source license as plain text; WiX's agreement control requires RTF.
function toRtf(text) {
  const escaped = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('').map(character => {
    if (character === '\n') return '\\par\n';
    if ('\\{}'.includes(character)) return '\\' + character;
    if (character === '\t') return '\\tab ';
    const code = character.charCodeAt(0);
    return code > 127 ? `\\u${code > 32767 ? code - 65536 : code}?` : character;
  }).join('');
  return '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\uc1\\f0\\fs18\n' + escaped + '\n}';
}

module.exports = async function addMsiLicense(projectFile) {
  const license = await fs.readFile(path.join(__dirname, '..', 'markdoc_license.txt'), 'utf8');
  if (!license.trim()) throw new Error('markdoc_license.txt must not be empty');
  const rtfPath = path.join(path.dirname(projectFile), 'markdoc-license.rtf');
  await fs.writeFile(rtfPath, toRtf(license), 'ascii');
  let project = await fs.readFile(projectFile, 'utf8');
  function replaceRequired(before, after) {
    if (!project.includes(before)) throw new Error('MSI license hook: installer template changed; review agreement navigation');
    project = project.replace(before, after);
  }
  const xmlPath = rtfPath.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  replaceRequired('<UIRef Id="WixUI_InstallDir"/>', `<WixVariable Id="WixUILicenseRtf" Value="${xmlPath}"/>\n      <UIRef Id="WixUI_InstallDir"/>`);
  replaceRequired(
    '<Publish Dialog="WelcomeDlg" Control="Next" Event="NewDialog" Value="InstallScopeDlg" Order="2">NOT Installed</Publish>',
    '<!-- WixUI_InstallDir already routes Welcome to LicenseAgreementDlg. -->\n        <Publish Dialog="LicenseAgreementDlg" Control="Next" Event="NewDialog" Value="InstallScopeDlg" Order="3">LicenseAccepted = "1"</Publish>',
  );
  replaceRequired(
    '<Publish Dialog="InstallScopeDlg" Control="Back" Event="NewDialog" Value="WelcomeDlg" Order="1">1</Publish>',
    '<Publish Dialog="InstallScopeDlg" Control="Back" Event="NewDialog" Value="LicenseAgreementDlg" Order="1">1</Publish>',
  );
  await fs.writeFile(projectFile, project, 'utf8');
};
