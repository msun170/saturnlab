#!/usr/bin/env python3
# Converted from: test-step5.ipynb

# # Step 5 Test: Rich Output, Export, and Settings

# ## 5.1 Plotly Charts
# Run the cell below. You should see an interactive Plotly chart in a sandboxed iframe.

# Plotly test (requires: pip install plotly)
try:
    import plotly.graph_objects as go
    fig = go.Figure(data=go.Scatter(x=[1,2,3,4,5], y=[2,4,3,5,4], mode="lines+markers", name="Data"))
    fig.update_layout(title="Plotly in Saturn", xaxis_title="X", yaxis_title="Y")
    fig.show()
except ImportError:
    print("Plotly not installed. Run: pip install plotly")

# ## 5.2 Bokeh Charts
# Run the cell below. You should see a Bokeh chart rendered via HTML.

# Bokeh test (requires: pip install bokeh)
try:
    from bokeh.plotting import figure, show
    from bokeh.io import output_notebook
    output_notebook()
    p = figure(title="Bokeh in Saturn", x_axis_label="X", y_axis_label="Y", width=500, height=300)
    p.line([1,2,3,4,5], [6,7,2,4,5], line_width=2, color="navy")
    p.circle([1,2,3,4,5], [6,7,2,4,5], size=8, color="red")
    show(p)
except ImportError:
    print("Bokeh not installed. Run: pip install bokeh")

# ## 5.3 Altair/Vega Charts
# Run the cell below. You should see an Altair chart.

# Altair test (requires: pip install altair vega_datasets)
try:
    import altair as alt
    import pandas as pd
    data = pd.DataFrame({"x": range(20), "y": [x**2 for x in range(20)]})
    chart = alt.Chart(data).mark_circle(size=60).encode(
        x="x", y="y",
        tooltip=["x", "y"]
    ).properties(title="Altair in Saturn", width=400, height=250)
    chart.display()
except ImportError:
    print("Altair not installed. Run: pip install altair")

# ## 5.4 iframe Sandboxing
# The Plotly/Bokeh charts above should render inside sandboxed iframes. You can verify by right-clicking the chart area and checking that it says "iframe" in the context menu.
# 
# Also test with raw HTML containing scripts:

# Raw HTML with script (should render in sandboxed iframe)
from IPython.display import HTML
HTML("""<div style="padding:20px;background:#e8f5e9;border-radius:8px;text-align:center">
    <h3 id="dynamic">Loading...</h3>
    <script>document.getElementById("dynamic").textContent = "This HTML was rendered in a sandboxed iframe!";</script>
</div>""")

# ## 5.6 Export
# 
# ### Export to Python
# 1. Go to **File > Download as Python (.py)**
# 2. Save the file
# 3. Open it in a text editor
# 4. Verify: code cells are plain Python, markdown cells are comments prefixed with #
# 
# ### Export to HTML
# 1. Go to **File > Download as HTML**
# 2. Save the file
# 3. Open it in a browser
# 4. Verify: code cells show as code blocks, outputs are embedded (tables, images)
# 
# ### Save Without Outputs
# 1. Go to **File > Save Without Outputs**
# 2. Save as a new file
# 3. Open the new file in Saturn
# 4. Verify: all code is there but no outputs, no execution counts

# ## 5.7 Settings
# 
# ### Font Size
# 1. Go to **Help > Settings**
# 2. Change font size to **20**
# 3. Click **Save**
# 4. Code AND output text should be larger
# 
# ### Auto-save Interval
# 1. Change auto-save to **10 seconds**, Save
# 2. Run a cell to make the tab dirty
# 3. Wait 10 seconds
# 4. Green "Autosaved at HH:MM:SS" should appear in status bar
# 
# ### Kernel Auto-stop
# 1. Set auto-stop to **After 2 minutes (testing)**
# 2. Save, open a second tab with a running kernel
# 3. Stay on this tab for 2+ minutes
# 4. The other tab should show a pause icon

# Basic output for export testing
import pandas as pd
import numpy as np

df = pd.DataFrame(np.random.randn(10, 3), columns=["A", "B", "C"])
print("Summary:")
print(df.describe())
df

# Matplotlib for export testing (image should appear in HTML export)
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 10, 100)
plt.figure(figsize=(6, 3))
plt.plot(x, np.sin(x), label="sin")
plt.plot(x, np.cos(x), label="cos")
plt.title("Export Test Plot")
plt.legend()
plt.show()

# ## Test Checklist
# 
# - [ ] Plotly chart renders interactively (hover shows values)
# - [ ] Bokeh chart renders (if installed)
# - [ ] Altair chart renders (if installed)
# - [ ] HTML with script renders in iframe (shows green box with text)
# - [ ] File > Download as Python (.py) exports correctly
# - [ ] File > Download as HTML exports with outputs embedded
# - [ ] File > Save Without Outputs creates clean version
# - [ ] Font size change takes effect immediately
# - [ ] Auto-save interval change takes effect
# - [ ] Kernel auto-stop works at 2-minute setting
