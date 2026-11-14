I want to have a proper OKR planning and reviewing tool. I used that one before: https://www.okrstool.com which was actually good, but I got upset that the free version is limited to one cycle and for the full version you need to pay a lot as a private person.

As this is not rocket science, I thought it makes sense to vibe code it.

Here are my ideas:
- it should be browser-based, but locally hosted
- it may write data directly on my hard drive in the same folder as the tool (if one project requires the use of multiple data they should be stored into one project folder)
- if possible apply auto-saving once the file/folder is defined
- it should allow the loading of different projects, but they should not be displayed together; so it just needs to load one project at a time
- it should allow me to set strategic company goals (this one with an enforced hierarchy and max. 3 goals), objectives, corresponding key results, and also initiatives
- it should allow me to define users and assign them to objectives, key results, and initiatives - objectives and key results should have a single owner, while initiatives have an owner and collaborators
- it should allow the setting of the OKR cadence, for instance quartely and it should allow the starting point, e.g., which month and year shall the cycle start from
- once starting point and cadence is set, the tool should automatically follow that rhythm aligning timing with the computer time the tool is used on
- the key results should have a drop down to define the metric to be able to measure the percentage of achievement: a number with target, percentage with target, yes/no, threshold above/below, setting multiple milestones
- initiatives should have a simple percentage metric to measure where they stand. They need a priority (1 to 3) definition, and owner and - if needed - collaborator, and a target date. The status should be able to set to "to do", "in progress", "blocked", and "done" so there is a possibility to visualize them on a Kanban board
- the overall achievement of the objective should be measured by considering the individual achievement of the key results
- there should be four tabs for four window views: 1) current cycle, 2) review, 3) planning, 4) history
- the current cycle view should display the OKRs of the current cycle visualizing the current progress; I envision a view that starts from top to down: objectives > click on it to see the key results > click on it to see the initiatives; allow for editing by clicking on individual items. On top of that, the company goals shall be displayed to see the link between OKRs and company strategy. There should be two views in this view to toggle between: OKR view and initiatives (Kanban board) view
- the review view should provide an overview of the performance of the last period plus a documented review input (why were we successful? why did we fail? what needs to happen to do it better next time?)
- the planning view should allow for setting the new OKRs for the next period. There should be a button to start the new planning phase. If the review phase has been skipped it should tell the user to first perform the review phase only then he will be allowed to start a new planning - this does not apply to a new project which has no history. The planning view should first display the company goals and question whether they are still up to date? It should then ask what is the single most impactful thing that needs to happen to move us closer to those goals with respect and document the outcome? Just then the OKR definition should start. Once finalized, the OKRs should be set active for the next cycle through a submit button.
- the history view should display the performance over the entire project period and allow for screening through the previous cycles and then allow to dig again into the corresponding objectives and key results
- the tool should be built in a way to allow for backwards-compatibility if I develop it further