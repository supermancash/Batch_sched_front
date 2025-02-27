import React, {useState, useEffect} from "react";
import './App.css';
import JobModal from "./JobModal";
import InfoModal from "./InfoModal";
import cron from 'cron';
import cronParser from 'cron-parser';
import {MdClose} from 'react-icons/md';
import createIcon from './icons/create-icon.png';
import refreshIcon from './icons/refresh-icon.png';
import infoIcon from './icons/info-icon.png';
import editIcon from './icons/edit-icon.png';
import deleteIcon from './icons/delete-icon.png';
import status1Icon from './icons/status-1.png';
import status2Icon from './icons/status-2.png';
import status3Icon from './icons/status-3.png';
import status4Icon from './icons/status-4.png';
import status5Icon from './icons/status-5.png';
import sortIcon from './icons/sort.png';

const {CronJob} = cron;

// ❌ Dein App file ist viel zu voll gecluttered, der soll eigentlich nur die ganzen verschiedenen react components die du hast einbinden
// (ich hab dir unten markiert wo du neue components anlegen solltest)
// generelle regel ==> App.js file über 100 zeilen = schlecht
function App() {
    // ✅ state am anfang vom file definiert, sehr gut 
    const [jobs, setJobs] = useState([]);
    const [jobId, setJobId] = useState(null);
    const [filteredJobs, setFilteredJobs] = useState([]);
    const [searchTermName, setSearchTermName] = useState("");
    const [searchTermId, setSearchTermId] = useState("");
    const [statusFilter, setStatusFilter] = useState(["All"]);
    const [JobModalIsOpen, setJobModalIsOpen] = useState(false);
    const [InfoModalIsOpen, setInfoModalIsOpen] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [refreshCounter, setRefreshCounter] = useState(0);
    const [rotationDegrees, setRotationDegrees] = useState(0);
    const [sortConfig, setSortConfig] = useState({key: 'job_id', direction: 'asc'});
    const [jobToDelete, setJobToDelete] = useState(null);
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);

    // get last exec and stat of job by id
    const fetchLatestEndTimeAndStatus = async (jobId) => {
        try {
            const response = await fetch(`http://localhost:8080/execution/${jobId}`);
            // ❌ dieser if block ist überflüssig, das selbe ereignis wird schon gecatched
            if (!response.ok) {
                if (response.status !== 404) {
                    console.error(
                        `Error fetching executions for job ${jobId}: ${response.statusText}`
                    );
                }
                return {lastRun: null, status: null};
            }
            const executions = await response.json();
            if (executions.length === 0) {
                return {lastRun: null, status: null};
            }
            const latestEndTime = executions.reduce((latest, execution) => {
                const endTime = new Date(execution.end_time);
                return endTime > latest
                    ? endTime
                    : latest;
            }, new Date(0));

            const executionStatus = calculateStatus(executions);
            return {lastRun: latestEndTime, executionStatus};
        } catch (error) {
            console.error(`Error fetching executions for job ${jobId}:`, error);
            return {lastRun: null, status: null};
        }
    };

    // ✅ super wie du dein code kommentierst
    // fetch jobs again after changes currently triggering 3 times when initial
    // load.. expecting error with refreshCounter but couldnt pin it down
    useEffect(() => {
        const fetchJobs = async () => {
            try {
                const response = await fetch("http://localhost:8080/job");
                const data = await response.json();

                //filter all fetched jobs
                const filtered = data
                .filter((job) => {
                    if (statusFilter.includes("All")) {
                        return true;
                    }
                    return statusFilter.includes(job.status ? "Enabled" : "Disabled");
                })
                    .filter((job) => {
                        if (searchTermName) {
                            return job.name.toLowerCase().includes(searchTermName.toLowerCase());
                        }
                        if (searchTermId) {
                            return job.job_id.toString().includes(searchTermId);
                        }
                        return true;
                    });

                const withLastRunsAndStatus = await Promise.all(filtered.map(async (job) => {
                    const {lastRun, executionStatus} = await fetchLatestEndTimeAndStatus(
                        job.job_id
                    );

                    let nextRun = null;
                    if (job.status) {
                        const {nextRun: calculatedNextRun} = await calculateRunTimes(job);
                        nextRun = calculatedNextRun;
                    }

                    return {
                        ...job,
                        lastRun,
                        nextRun,
                        executionStatus
                    };
                }));

                setFilteredJobs(withLastRunsAndStatus);

            } catch (error) {
                console.error("Error fetching jobs:", error);
            }
        };
        // add to see triggers in devtool: console.log("Dependencies changed:", {
        // statusFilter, searchTermName, searchTermId, refreshCounter });
        fetchJobs();
        const interval = setInterval(() => {
            fetchJobs();
        }, 10 * 1000);
        return() => clearInterval(interval);
    }, [statusFilter, searchTermName, searchTermId, refreshCounter]);

    // enable/disable seperated to not send complete job like in jobmodal only for
    // status
    const handleStatusToggle = (jobId, currentStatus) => {
        console.log(
            "Toggling status for jobId:",
            jobId,
            "currentStatus:",
            currentStatus
        );
        const newStatus = !currentStatus;
        fetch(`http://localhost:8080/job/${jobId}/status`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({status: newStatus})
        })
            .then((response) => {
                if (response.ok) {
                    console.log("Status updated successfully");
                    setRefreshCounter((prevCounter) => prevCounter + 1);
                } else {
                    console.error(`Error updating status for job ${jobId}: ${response.statusText}`);
                }
            })
            .catch(
                (error) => console.error(`Error updating status for job ${jobId}:`, error)
            );
    };

    //sort icon next to table header that dictates the sort
    const renderSortIcon = (key) => {
        if (sortConfig.key === key) {
            const rotation = sortConfig.direction === 'asc'
                ? '0deg'
                : '180deg';
            return <img
                src={sortIcon}
                alt="sort"
                style={{
                    width: "15px",
                    filter: "invert(100%)",
                    transform: `rotate(${rotation})`
                }}/>;
        }
        return null;
    };

    // ❌ wieso so kompliziert? asc als boolean variabel und dann funktion: toggleAsc {setAsc(!asc)}
    // set sort config asc or desc
    const sortBy = (key) => {
        let direction = 'asc';

        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }

        setSortConfig({key, direction});
    };

    // sort jobs by table header + asc/desc
    const sortedJobs = React.useMemo(() => {
        return filteredJobs
            .slice()
            .sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];

                if (sortConfig.key === 'name') {
                    aValue = aValue.toLowerCase();
                    bValue = bValue.toLowerCase();
                }

                if (aValue < bValue) {
                    return sortConfig.direction === 'asc'
                        ? -1
                        : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'asc'
                        ? 1
                        : -1;
                }
                return 0;
            });
    }, [filteredJobs, sortConfig]);

    // weather indicator like in jenkins, values to be adjusted?
    const calculateStatus = (executions) => {
        const lastExecutions = executions.slice(-10);
        const successfulExecutions = lastExecutions.filter(
            (execution) => execution.success === true
        );
        const successRate = successfulExecutions.length / lastExecutions.length;

        // 1 = good, 5 = bad
        if (successRate >= 0.9) 
            return 1;
        if (successRate >= 0.7) 
            return 2;
        if (successRate >= 0.5) 
            return 3;
        if (successRate >= 0.3) 
            return 4;
        return 5;
    };

    const statusImages = {
        1: status1Icon,
        2: status2Icon,
        3: status3Icon,
        4: status4Icon,
        5: status5Icon
    };

    // ❌ wieso bei beiden funktionen drei setState() aufrufe? gibt bestimmt eine schönere lösung.
    const handleSearchName = (event) => {
        const value = event.target.value;
        setSearchTermName(value);
        setSearchTermId("");
        setStatusFilter("All");
    };

    const handleSearchId = (event) => {
        const value = event.target.value;
        setSearchTermId(value);
        setSearchTermName("");
        setStatusFilter("All");
    };

    const handleRefresh = () => {
        setRotationDegrees((prevDegrees) => prevDegrees + 180);
        setRefreshCounter((prev) => prev + 1);
    };

    //run time with nextrun in fut
    function calculateRunTimes(job) {
        const {start_date, cronExpression} = job;

        const options = {
            currentDate: new Date(),
            tz: "UTC"
        };

        const nextRun = cronParser
            .parseExpression(cronExpression, options)
            .next()
            .toDate();

        if (nextRun >= new Date(start_date)) {
            return {nextRun: nextRun.toISOString()};
        } else {
            options.currentDate = new Date(start_date);
            const nextValidRun = cronParser
                .parseExpression(cronExpression, options)
                .next()
                .toDate();

            return {nextRun: nextValidRun.toISOString()};
        }
    }

    const handleInfo = (jobId) => {
        setInfoModalIsOpen(true);
        setJobId(jobId);
    };

    const handleCreate = () => {
        setJobModalIsOpen(true);
        setIsEditing(false);
    };

    function handleEdit(jobId) {
        setJobModalIsOpen(true);
        setIsEditing(true);
        setJobId(jobId);
    }

    // ❌ funktion definition overkill, du rufst nur setState auf
    const closeInfo = () => {
        setInfoModalIsOpen(false);
    };

    const closeCreate = () => {
        setJobModalIsOpen(false);
    };

    const closeEdit = () => {
        setJobModalIsOpen(false);
    };

    //update job list after closing jobmodal to see edit/create result
    useEffect(() => {
        if (!JobModalIsOpen) {
            setRefreshCounter((prev) => prev + 1);
        }
    }, [JobModalIsOpen]);

    function openConfirmDialog() {
        setShowConfirmDialog(true);
    }

    // delete job by id
    function handleDelete(jobToDelete) {
        setShowConfirmDialog(false);
        const url = `http://localhost:8080/job/${jobToDelete.job_id}`;
        fetch(url, {method: 'DELETE'})
            .then(response => {
                if (response.ok) {
                    fetch("http://localhost:8080/job")
                        .then((response) => response.json())
                        .then((data) => {
                            setJobs(data);
                            setRefreshCounter((prev) => prev + 1);
                        })
                        .catch((error) => console.error("Error fetching jobs:", error));
                } else {
                    console.error(`Error deleting job with id ${jobId}: ${response.statusText}`);
                }
            })
            .catch(error => console.error(`Error deleting job with id ${jobId}: ${error}`));
    }

    useEffect(() => {
        const closeOnOutsideClick = (e) => {
            if (e.target === document.querySelector('.confirmation-dialog')) {
                setShowConfirmDialog(false);
            }
        };

        if (showConfirmDialog) {
            window.addEventListener('click', closeOnOutsideClick);
        }

        return() => {
            window.removeEventListener('click', closeOnOutsideClick);
        };
    }, [showConfirmDialog]);

    return (
        <div className="App">
            <header className="App-header">
                <h1>Batch Scheduler</h1>
            </header>
            <div className="App-container">
                <!-- eigene componente>
                <div className="App-options">
                    <div className="btn-container">
                        <button className="create-btn" onClick={handleCreate}>
                            <img src={createIcon} alt="create icon" className="create-icon"/>
                            <span>Create Job</span>
                        </button>
                        <button className="refresh-btn" onClick={handleRefresh}>
                            <img
                                src={refreshIcon}
                                alt="refresh icon"
                                className="refresh-icon"
                                style={{
                                    transform: `rotate(${rotationDegrees}deg)`,
                                    transition: 'transform 0.5s'
                                }}/>
                            <span>Refresh</span>
                        </button>

                    </div>

                    <div className="App-search-container">
                        <div className="App-search">
                            <input
                                type="text"
                                placeholder="Search by name"
                                value={searchTermName}
                                onChange={handleSearchName}/>
                        </div>
                        <div className="App-search">
                            <input
                                type="text"
                                placeholder="Search by ID"
                                value={searchTermId}
                                onChange={handleSearchId}/>
                        </div>
                    </div>
                    <div className="App-status">
                        <label>Filter by status:</label>
                        <div className="status-filters">
                            <div className="status-filter">
                                <div className="status-label-container" onClick={() => setStatusFilter("All")}>
                                    <input
                                        type="checkbox"
                                        id="all"
                                        value="All"
                                        checked={statusFilter.includes("All")}
                                        onChange={() => {}}/>
                                    <label htmlFor="all">All</label>
                                </div>
                            </div>
                            <div className="status-filter">
                                <div
                                    className="status-label-container"
                                    onClick={() => setStatusFilter("Enabled")}>
                                    <input
                                        type="checkbox"
                                        id="enabled"
                                        value="Enabled"
                                        checked={statusFilter.includes("Enabled")}
                                        onChange={() => {}}/>
                                    <label htmlFor="enabled">Enabled</label>
                                </div>
                            </div>
                            <div className="status-filter">
                                <div
                                    className="status-label-container"
                                    onClick={() => setStatusFilter("Disabled")}>
                                    <input
                                        type="checkbox"
                                        id="disabled"
                                        value="Disabled"
                                        checked={statusFilter.includes("Disabled")}
                                        onChange={() => {}}/>
                                    <label htmlFor="disabled">Disabled</label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- eigene componente-->
                <div className="App-list">
                    <table>
                        <thead>
                            <tr className="table-headers">
                                <th onClick={() => sortBy('job_id')}>ID {renderSortIcon('job_id')}</th>
                                <th onClick={() => sortBy('name')}>Name {renderSortIcon('name')}</th>
                                <th onClick={() => sortBy('status')}>Status {renderSortIcon('status')}</th>
                                <th onClick={() => sortBy('lastRun')}>LastRun {renderSortIcon('lastRun')}</th>
                                <th onClick={() => sortBy('nextRun')}>NextRun {renderSortIcon('nextRun')}</th>
                                <th
                                    style={{
                                        cursor: "auto"
                                    }}></th>
                            </tr>
                        </thead>
                        <tbody className="table-body">
                            {
                                sortedJobs.map((job) => (
                                    <React.Fragment key={job.job_id}>
                                        <tr onDoubleClick={() => handleInfo(job.job_id)}>
                                            <td>{job.job_id}</td>
                                            <td>{job.name}</td>
                                            <td>
                                                <span
                                                    className="status-text"
                                                    style={{
                                                        textDecoration: "underline",
                                                        cursor: "pointer"
                                                    }}
                                                    onClick={() => handleStatusToggle(job.job_id, job.status)}>
                                                    {
                                                        job.status
                                                            ? "Enabled"
                                                            : "Disabled"
                                                    }
                                                </span>
                                            </td>
                                            <td>
                                                <span className="last-run-date">
                                                    {
                                                        job.lastRun
                                                            ? new Date(job.lastRun).toLocaleString()
                                                            : "N/A"
                                                    }
                                                </span>
                                                {
                                                    job.executionStatus && <img
                                                            className="status-img"
                                                            src={statusImages[job.executionStatus]}
                                                            alt={`Status ${job.executionStatus}`}/>
                                                }
                                            </td>
                                            <td>
                                                {
                                                    job.status && job.nextRun
                                                        ? new Date(job.nextRun).toLocaleString()
                                                        : "N/A"
                                                }
                                            </td>

                                            <td className="actions">
                                                <div className="button-container">
                                                    <button className="info-btn" onClick={() => handleInfo(job.job_id)}>
                                                        <img src={infoIcon} alt="info icon" className="info-icon"/>
                                                    </button>
                                                    <button className="edit-btn" onClick={() => handleEdit(job.job_id)}>
                                                        <img src={editIcon} alt="edit icon" className="edit-icon"/>
                                                    </button>
                                                    <button
                                                        className="delete-btn"
                                                        onClick={() => {
                                                            openConfirmDialog();
                                                            setJobToDelete({job_id: job.job_id, name: job.name});
                                                        }}>
                                                        <img src={deleteIcon} alt="delete icon" className="delete-icon"/>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    </React.Fragment>
                                ))
                            }
                        </tbody>

                    </table>
                </div>

                <JobModal
                    isOpen={JobModalIsOpen}
                    closeModal={() => {
                        closeCreate();
                        closeEdit();
                    }}
                    isEditing={isEditing}
                    jobId={jobId}/>

                <InfoModal
                    isOpen={InfoModalIsOpen}
                    closeModal={() => {
                        closeInfo();
                    }}
                    jobId={jobId}/>

            </div>
            <!-- eigene componente => Footer.js-->
            <div className="App-footer">
                <p>Batch Scheduler by Fishi</p>
            </div>
            {
                showConfirmDialog && (
                    <div className="confirmation-dialog">

                        <div className="confirmation-dialog-content">
                            <button
                                className="close-confirmation-dialog-button"
                                style={{}}
                                onClick={() => setShowConfirmDialog(false)}><MdClose/></button>
                            <p>Are you sure you want to delete this job?</p>
                            {
                                jobToDelete && (
                                    <> < p className = "delete-info" > Job ID : <span className="delete-info-label">{jobToDelete.job_id}</span>
                                </p>
                                <p className="delete-info">Job Name : <span className="delete-info-label">{jobToDelete.name}</span>
                                </p>
                            </>
                                )
                            }
                            <div className="confirmation-dialog-buttons">
                                <button
                                    className="confirm-delete-button"
                                    onClick={() => handleDelete(jobToDelete)}>Delete job</button>
                            </div>
                        </div>
                    </div>
                )
            }

        </div>
    );
}

export default App;
