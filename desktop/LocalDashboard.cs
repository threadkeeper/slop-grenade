using System;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;

namespace SlopGrenadeDesktop
{
    internal sealed class LocalDashboard
    {
        public readonly string ApiBase;

        public LocalDashboard(string httpBind)
        {
            int port = 8090;
            int configuredPort;
            const string prefix = "127.0.0.1:";
            if (httpBind != null && httpBind.StartsWith(prefix, StringComparison.Ordinal)
                && int.TryParse(httpBind.Substring(prefix.Length), NumberStyles.None, CultureInfo.InvariantCulture, out configuredPort)
                && configuredPort > 0 && configuredPort <= 65535)
                port = configuredPort;
            ApiBase = "http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture);
        }

        public void OpenGmail(Action<string> openBrowser)
        {
            OpenGmailSignIn(openBrowser);
        }

        public void OpenGmailSignIn(Action<string> openBrowser)
        {
            openBrowser(ApiBase + "/?gmail=signin");
        }

        public void OpenGmailSignOut(Action<string> openBrowser)
        {
            openBrowser(ApiBase + "/?gmail=signout");
        }

        public void OpenM365SignIn(Action<string> openBrowser)
        {
            openBrowser(ApiBase + "/?m365=signin");
        }

        public void OpenM365SignOut(Action<string> openBrowser)
        {
            openBrowser(ApiBase + "/?m365=signout");
        }

        public GmailStatus ReadGmailStatus()
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(ApiBase + "/api/v1/auth/status");
                request.Method = "GET";
                request.AllowAutoRedirect = false;
                request.Proxy = null;
                request.UseDefaultCredentials = false;
                request.Timeout = 2000;
                request.ReadWriteTimeout = 2000;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    if (response.StatusCode != HttpStatusCode.OK) return GmailStatus.Unavailable;
                    using (Stream stream = response.GetResponseStream())
                    using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        char[] buffer = new char[GmailStatus.MaxStatusLength + 1];
                        int count = reader.ReadBlock(buffer, 0, buffer.Length);
                        return GmailStatus.FromAuthJson(new string(buffer, 0, count));
                    }
                }
            }
            catch (WebException) { return GmailStatus.Unavailable; }
            catch (IOException) { return GmailStatus.Unavailable; }
        }
    }
}
